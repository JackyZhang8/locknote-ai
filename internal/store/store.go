// Package store is the plaintext persistence layer of Locknote MCP.
//
// Unlike the original LockNote (which encrypts every note body with a master
// password), this build stores notes as ordinary Markdown in SQLite. That is a
// deliberate trade-off: AI agents must be able to read and write notes without
// a human present to unlock a vault.
package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a row does not exist (or was hard deleted).
var ErrNotFound = errors.New("not found")

const schemaVersion = 3

// Store wraps the SQLite connection.
type Store struct {
	tokenMu    sync.Mutex
	db         *sql.DB
	path       string
	ftsEnabled bool
}

// Open opens (and creates if needed) the database at path.
func Open(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("store: empty database path")
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("store: create data dir: %w", err)
		}
	}

	dsn := "file:" + path +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	// A single connection keeps writers serialised, which removes the usual
	// SQLITE_BUSY races between the web UI and an MCP client.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}

	s := &Store{db: db, path: path}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.ensureSeed(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Path returns the database file path.
func (s *Store) Path() string { return s.path }

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// schemaSQL is embedded from schema_v3.sql (see indexes.go), which is shared
// with tools/stress_seed.py so both writers agree on the table layout.

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schemaSQL); err != nil {
		return fmt.Errorf("store: migrate: %w", err)
	}
	// CREATE TABLE IF NOT EXISTS will not add columns to an existing database,
	// so patch pre-v3 libraries here (pinned is from schemaVersion 1).
	for _, c := range []struct{ table, column, ddl string }{
		{"notebooks", "pinned", "INTEGER NOT NULL DEFAULT 0"},
		{"tags", "pinned", "INTEGER NOT NULL DEFAULT 0"},
		{"notebooks", "note_count", "INTEGER NOT NULL DEFAULT 0"},
		{"notes", "tags_text", "TEXT NOT NULL DEFAULT ''"},
		{"tags", "note_ids", "TEXT NOT NULL DEFAULT ''"},
		{"tags", "note_count", "INTEGER NOT NULL DEFAULT 0"},
	} {
		if err := s.ensureColumn(c.table, c.column, c.ddl); err != nil {
			return err
		}
	}
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return fmt.Errorf("store: read schema version: %w", err)
	}
	// Anything below v3 needs a one-off rebuild of the materialised columns and
	// the FTS index. Bulk loaders may also leave user_version below 3 on
	// purpose so that the first application start finishes the job.
	if err := s.installIndexes(v < schemaVersion); err != nil {
		return err
	}
	if v < schemaVersion {
		if _, err := s.db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, schemaVersion)); err != nil {
			return fmt.Errorf("store: set schema version: %w", err)
		}
	}
	return nil
}

// ensureColumn adds a column to an existing table if it is not there yet.
func (s *Store) ensureColumn(table, column, ddl string) error {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return fmt.Errorf("store: inspect %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return fmt.Errorf("store: inspect %s: %w", table, err)
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + ddl); err != nil {
		return fmt.Errorf("store: add %s.%s: %w", table, column, err)
	}
	return nil
}

// ensureSeed inserts a couple of notebooks the first time the database is used
// so that a fresh install is not an empty void.
func (s *Store) ensureSeed() error {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM notebooks`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	seed := []struct {
		name, icon, color, desc string
	}{
		{"收集箱", "inbox", "#97b6c3", "随手记下还没整理的想法"},
		{"工作项目", "book", "#a8bc8d", "正在推进的事情"},
		{"学习与阅读", "book", "#d4b989", "读书、课程与长期积累"},
	}
	now := nowString()
	for i, it := range seed {
		if _, err := s.db.Exec(
			`INSERT INTO notebooks (id, name, icon, color, description, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			NewID("nb"), it.name, it.icon, it.color, it.desc, i, now, now,
		); err != nil {
			return fmt.Errorf("store: seed notebooks: %w", err)
		}
	}
	return s.seedWelcomeNotes()
}

// seedWelcomeNotes writes two onboarding notes the first time the library is
// empty. They explain the plaintext + MCP model better than an empty screen.
func (s *Store) seedWelcomeNotes() error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	welcome := `LockNote.ai 把「笔记」和「AI」放在同一个库上：你在界面里写，AI 通过 MCP 读写，双方看到的是同一份 Markdown。

## 三件事

- **纯 Markdown 明文**：笔记存在本地的一个 SQLite 文件里，随时可以备份、迁移，或用其他工具直接读取。
- **内置 MCP 服务**：一个端点（` + "`/mcp`" + `）加一个令牌，任何支持 MCP 的客户端都能接入。
- **双向可见**：AI 写入的笔记会立刻出现在左侧列表，带 **AI** 标记；你改完之后，AI 下次读到的就是新内容。

## 现在可以试试

1. 点击右上角「接入 AI」，复制端点与令牌。
2. 粘进 Claude Code / Cursor / 任意 MCP 客户端。
3. 对 AI 说：「把这份方案存到 LockNote.ai 的工作项目里」。

> 数据只有一份，存在本机，随时可以备份。
`
	guide := `让 AI 保存文档时，把「写给谁看」说清楚，比说「保存一下」有效得多。

## 推荐的提问方式

- 把**项目概览、架构、接口、部署**拆成多篇，而不是塞进一篇长文。
- 指定笔记本，例如「工作项目」；不指定就会进入未分类。
- 让 AI 使用稳定的 ` + "`external_id`" + `，同一份文档再次保存时会覆盖而不是重复。

## 它会调用哪些工具

| 工具 | 用途 |
| --- | --- |
| ` + "`save_note`" + ` | 保存或更新一篇文档 |
| ` + "`search_notes`" + ` | 在已有笔记里查找 |
| ` + "`get_note`" + ` | 读取全文再改写 |
| ` + "`workspace_overview`" + ` | 先了解库里有什么 |

写完以后回到这个界面，列表会自动刷新。
`
	nbs, err := s.ListNotebooks()
	if err != nil {
		return err
	}
	byName := map[string]string{}
	for _, nb := range nbs {
		byName[nb.Name] = nb.ID
	}
	type item struct {
		title, content, notebook string
		pinned                   bool
		tags                     []string
	}
	items := []item{
		{"欢迎使用 LockNote.ai", welcome, "收集箱", true, []string{"指南"}},
		{"让 AI 把项目文档写进来", guide, "工作项目", false, []string{"指南", "MCP"}},
	}
	for _, it := range items {
		nbID := byName[it.notebook]
		if _, err := s.CreateNote(NoteInput{
			Title:      it.title,
			Content:    it.content,
			NotebookID: nbID,
			Pinned:     &it.pinned,
			Tags:       it.tags,
			Source:     "web",
		}); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// NewID returns a short, sortable, collision-resistant identifier.
func NewID(prefix string) string {
	var buf [12]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// crypto/rand should never fail; fall back to the clock.
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	id := base32Hex(buf[:])
	if prefix == "" {
		return id
	}
	return prefix + "_" + id
}

func base32Hex(b []byte) string {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
	var out strings.Builder
	for i := 0; i < len(b); i += 5 {
		chunk := b[i:]
		if len(chunk) > 5 {
			chunk = chunk[:5]
		}
		var v uint64
		for _, c := range chunk {
			v = v<<8 | uint64(c)
		}
		bits := len(chunk) * 8
		for bits >= 5 {
			bits -= 5
			out.WriteByte(alphabet[(v>>uint(bits))&31])
		}
		if bits > 0 {
			out.WriteByte(alphabet[(v<<uint(5-bits))&31])
		}
	}
	return out.String()
}

func nowString() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC()
	}
	return time.Time{}
}

func nullString(p *string) sql.NullString {
	if p == nil || *p == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: *p, Valid: true}
}

// HashToken returns a stable hash for an API token. Tokens themselves are never
// stored in plaintext inside the database.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte("locknote-mcp:" + token))
	return hex.EncodeToString(sum[:])
}

// NewToken generates a token plus its hash and display prefix.
func NewToken() (token, hash, prefix string) {
	var buf [24]byte
	if _, err := rand.Read(buf[:]); err != nil {
		buf = [24]byte{}
		copy(buf[:], []byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	token = "locknote_" + base64.RawURLEncoding.EncodeToString(buf[:])
	return token, HashToken(token), token[:16] + "…"
}

// ---------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------

// Activity is one entry in the "AI 活动" feed shown in the UI.
type Activity struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Tool      string    `json:"tool,omitempty"`
	NoteID    string    `json:"noteId,omitempty"`
	NoteTitle string    `json:"noteTitle,omitempty"`
	Detail    string    `json:"detail,omitempty"`
	Actor     string    `json:"actor"`
	CreatedAt time.Time `json:"createdAt"`
}

// RecordActivity appends MCP tool activity (best effort, never fails a write).
func (s *Store) RecordActivity(kind, tool, noteID, noteTitle, detail, actor string) {
	if strings.TrimSpace(tool) == "" {
		return
	}
	if actor == "" {
		actor = "mcp"
	}
	_, _ = s.db.Exec(
		`INSERT INTO activity (id, kind, tool, note_id, note_title, detail, actor, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		NewID("act"), kind, tool, noteID, noteTitle, detail, actor, nowString(),
	)
	// Keep the feed small; it is a UI nicety, not an audit log.
	_, _ = s.db.Exec(`DELETE FROM activity WHERE id NOT IN (
		SELECT id FROM activity ORDER BY created_at DESC LIMIT 200)`)
}

// Activity returns recent MCP tool entries, excluding historical UI operations.
func (s *Store) Activity(limit int) ([]Activity, error) {
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	rows, err := s.db.Query(
		`SELECT id, kind, tool, note_id, note_title, detail, actor, created_at
		 FROM activity WHERE length(trim(tool)) > 0 ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Activity{}
	for rows.Next() {
		var a Activity
		var created string
		if err := rows.Scan(&a.ID, &a.Kind, &a.Tool, &a.NoteID, &a.NoteTitle, &a.Detail, &a.Actor, &created); err != nil {
			return nil, err
		}
		a.CreatedAt = parseTime(created)
		out = append(out, a)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

// Token is a stored MCP access token (hash only).
type Token struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

// CreateToken stores a token hash and returns the metadata plus plaintext token.
func (s *Store) CreateToken(name string) (Token, string, error) {
	token, hash, prefix := NewToken()
	if strings.TrimSpace(name) == "" {
		name = "MCP 客户端"
	}
	t := Token{ID: NewID("tok"), Name: name, Prefix: prefix, CreatedAt: time.Now().UTC()}
	if _, err := s.db.Exec(
		`INSERT INTO api_tokens (id, name, prefix, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		t.ID, t.Name, t.Prefix, hash, t.CreatedAt.Format(time.RFC3339Nano),
	); err != nil {
		return Token{}, "", err
	}
	return t, token, nil
}

// ListTokens returns all tokens without secrets.
func (s *Store) ListTokens() ([]Token, error) {
	rows, err := s.db.Query(`SELECT id, name, prefix, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Token{}
	for rows.Next() {
		var t Token
		var created string
		var last sql.NullString
		if err := rows.Scan(&t.ID, &t.Name, &t.Prefix, &created, &last); err != nil {
			return nil, err
		}
		t.CreatedAt = parseTime(created)
		if last.Valid {
			ts := parseTime(last.String)
			t.LastUsedAt = &ts
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteToken removes a token by id.
func (s *Store) DeleteToken(id string) error {
	res, err := s.db.Exec(`DELETE FROM api_tokens WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// VerifyToken checks a plaintext token and touches last_used_at.
func (s *Store) VerifyToken(token string) bool {
	if strings.TrimSpace(token) == "" {
		return false
	}
	hash := HashToken(token)
	var id string
	if err := s.db.QueryRow(`SELECT id FROM api_tokens WHERE token_hash = ?`, hash).Scan(&id); err != nil {
		return false
	}
	_, _ = s.db.Exec(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, nowString(), id)
	return true
}

// EnsureDefaultToken makes sure at least one token exists, returning the
// plaintext only when it had to be created.
func (s *Store) EnsureDefaultToken() (Token, string, error) {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM api_tokens`).Scan(&count); err != nil {
		return Token{}, "", err
	}
	if count > 0 {
		return Token{}, "", nil
	}
	return s.CreateToken("默认 MCP 令牌")
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

// Stats powers the workspace overview (also exposed as an MCP tool).
type Stats struct {
	Notes        int            `json:"notes"`
	Trash        int            `json:"trash"`
	Pinned       int            `json:"pinned"`
	Notebooks    int            `json:"notebooks"`
	Tags         int            `json:"tags"`
	Words        int            `json:"words"`
	FromAI       int            `json:"fromAi"`
	UpdatedToday int            `json:"updatedToday"`
	ByNotebook   []CountItem    `json:"byNotebook"`
	BySource     []CountItem    `json:"bySource"`
	LastUpdated  *time.Time     `json:"lastUpdated,omitempty"`
	Extra        map[string]any `json:"-"`
}

// CountItem is a label/value pair used by Stats.
type CountItem struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

// GetStats aggregates counters for the UI header and AI overview.
func (s *Store) GetStats() (Stats, error) {
	var st Stats
	row := s.db.QueryRow(`SELECT
		COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN deleted_at IS NULL AND pinned = 1 THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN word_count ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN deleted_at IS NULL AND source <> 'web' THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN deleted_at IS NULL AND substr(updated_at, 1, 10) = ? THEN 1 ELSE 0 END), 0)
		FROM notes`, time.Now().UTC().Format("2006-01-02"))
	if err := row.Scan(&st.Notes, &st.Trash, &st.Pinned, &st.Words, &st.FromAI, &st.UpdatedToday); err != nil {
		return st, err
	}
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM notebooks`).Scan(&st.Notebooks)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM tags`).Scan(&st.Tags)

	// The old LEFT JOIN + GROUP BY scanned every live note on each overview
	// request. Notebook counts are materialised now, so only the (small)
	// uncategorised bucket still needs a COUNT, and it is covered by
	// idx_notes_notebook_list.
	rows, err := s.db.Query(`
		SELECT name AS label, note_count AS c FROM notebooks WHERE note_count > 0`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var it CountItem
			if err := rows.Scan(&it.Label, &it.Count); err == nil {
				st.ByNotebook = append(st.ByNotebook, it)
			}
		}
	}
	var unclassified int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM notes
		WHERE deleted_at IS NULL AND notebook_id IS NULL`).Scan(&unclassified); err == nil && unclassified > 0 {
		st.ByNotebook = append(st.ByNotebook, CountItem{Label: "未分类", Count: unclassified})
	}
	sort.Slice(st.ByNotebook, func(i, j int) bool {
		if st.ByNotebook[i].Count != st.ByNotebook[j].Count {
			return st.ByNotebook[i].Count > st.ByNotebook[j].Count
		}
		return st.ByNotebook[i].Label < st.ByNotebook[j].Label
	})

	rows2, err := s.db.Query(`
		SELECT source, COUNT(*) FROM notes WHERE deleted_at IS NULL GROUP BY source ORDER BY 2 DESC`)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var it CountItem
			if err := rows2.Scan(&it.Label, &it.Count); err == nil {
				st.BySource = append(st.BySource, it)
			}
		}
	}

	var last string
	if err := s.db.QueryRow(`SELECT COALESCE(MAX(updated_at), '') FROM notes WHERE deleted_at IS NULL`).Scan(&last); err == nil && last != "" {
		ts := parseTime(last)
		st.LastUpdated = &ts
	}
	return st, nil
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

// GetSetting reads a setting value, returning def when absent.
func (s *Store) GetSetting(key, def string) string {
	var v string
	if err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v); err != nil {
		return def
	}
	return v
}

// SetSetting upserts a setting.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// sortedUnique normalises a list of tag/notebook names.
func sortedUnique(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || seen[strings.ToLower(v)] {
			continue
		}
		seen[strings.ToLower(v)] = true
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}
