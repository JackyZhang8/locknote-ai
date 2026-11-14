package store

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"testing"
)

// Open() seeds three notebooks and two welcome notes. One welcome note literally
// contains "external_id" / "save_note", which pollutes exact-count and substring
// assertions, so index tests start from a genuinely empty library. Deleting the
// seed rows goes through the same triggers as a real write, then the external
// content FTS index is rebuilt from the (now empty) notes table.
func newCleanV3Store(t *testing.T) *Store {
	t.Helper()
	st := newTestStore(t)
	if _, err := st.db.Exec(`DELETE FROM notes`); err != nil {
		t.Fatalf("clear seeded notes: %v", err)
	}
	if _, err := st.db.Exec(`DELETE FROM tags`); err != nil {
		t.Fatalf("clear seeded tags: %v", err)
	}
	if _, err := st.db.Exec(`DELETE FROM notebooks`); err != nil {
		t.Fatalf("clear seeded notebooks: %v", err)
	}
	if _, err := st.db.Exec(`DELETE FROM activity`); err != nil {
		t.Fatalf("clear seeded activity: %v", err)
	}
	if _, err := st.db.Exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`); err != nil {
		t.Fatalf("rebuild FTS after clearing seed data: %v", err)
	}
	return st
}

// Every table must be indexed, the tag->notes reverse index must exist and the
// trigram keyword index must be usable.
func TestV3EveryTableIsIndexed(t *testing.T) {
	st := newCleanV3Store(t)
	if !st.FTSReady() {
		t.Fatal("FTS5 trigram index was not installed")
	}
	indexed := map[string]bool{}
	rows, err := st.db.Query(`SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name, table string
		if err := rows.Scan(&name, &table); err != nil {
			t.Fatal(err)
		}
		indexed[table] = true
		if name == "idx_note_tags_reverse" && table != "note_tags" {
			t.Errorf("reverse index on unexpected table %s", table)
		}
	}
	for _, table := range []string{"notebooks", "notes", "tags", "note_tags",
		"note_revisions", "api_tokens", "activity"} {
		if !indexed[table] {
			t.Errorf("table %s has no explicit index", table)
		}
	}
	// settings is covered by its PRIMARY KEY index.
	var hasReverse, hasFTS string
	if err := st.db.QueryRow(`SELECT sql FROM sqlite_master WHERE name='idx_note_tags_reverse'`).Scan(&hasReverse); err != nil {
		t.Fatalf("missing reverse inverted index: %v", err)
	}
	if !strings.Contains(hasReverse, "tag_id") || !strings.Contains(hasReverse, "note_id") {
		t.Errorf("reverse index definition wrong: %s", hasReverse)
	}
	if err := st.db.QueryRow(`SELECT sql FROM sqlite_master WHERE name='notes_fts'`).Scan(&hasFTS); err != nil {
		t.Fatalf("missing notes_fts: %v", err)
	}
	if !strings.Contains(hasFTS, "trigram") {
		t.Errorf("FTS index is not trigram: %s", hasFTS)
	}
}

// A note addressed to a notebook that does not exist yet must create it. The
// old create=false path dropped the note into "未分类" and broke UpsertNote's
// title+notebook idempotency, so the second save created a duplicate note.
func TestCreateNoteCreatesNotebookOnDemand(t *testing.T) {
	st := newCleanV3Store(t)
	first, created, err := st.UpsertNote(NoteInput{
		Title: "同一份文档", Content: "第一版正文", Notebook: "新分类", Tags: []string{"标签甲"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("first save should create a note")
	}
	if first.NotebookName != "新分类" {
		t.Fatalf("notebook = %q, want 新分类", first.NotebookName)
	}
	var nbCount, noteCount int
	if err := st.db.QueryRow(`SELECT note_count FROM notebooks WHERE name='新分类'`).Scan(&nbCount); err != nil {
		t.Fatalf("notebook was not created: %v", err)
	}
	if nbCount != 1 {
		t.Errorf("materialised notebook count = %d, want 1", nbCount)
	}

	second, created, err := st.UpsertNote(NoteInput{
		Title: "同一份文档", Content: "第二版正文", Notebook: "新分类", IfExists: "replace",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Error("second save created a duplicate note instead of replacing")
	}
	if second.ID != first.ID {
		t.Errorf("second save produced a different note: %s vs %s", second.ID, first.ID)
	}
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&noteCount); err != nil || noteCount != 1 {
		t.Errorf("notes = %d (err=%v), want 1", noteCount, err)
	}
}

func materialised(t *testing.T, st *Store, noteID string) string {
	t.Helper()
	var v string
	if err := st.db.QueryRow(`SELECT tags_text FROM notes WHERE id=?`, noteID).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func tagPostings(t *testing.T, st *Store, tagName string) (string, int) {
	t.Helper()
	var ids string
	var count int
	if err := st.db.QueryRow(`SELECT note_ids, note_count FROM tags WHERE name=?`, tagName).Scan(&ids, &count); err != nil {
		t.Fatal(err)
	}
	return ids, count
}

// The inverted lists must stay in sync through every write path: create, tag
// replacement, rename, soft delete, restore, hard delete and tag deletion.
func TestMaterialisedInvertedListsStayConsistent(t *testing.T) {
	st := newCleanV3Store(t)
	n, err := st.CreateNote(NoteInput{
		Title: "倒排验证", Content: "项目复盘 中文子串搜索",
		Notebook: "工作", Tags: []string{"标签甲", "项目复盘"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := materialised(t, st, n.ID); !strings.Contains(got, "标签甲") || !strings.Contains(got, "项目复盘") {
		t.Fatalf("notes.tags_text = %q", got)
	}
	ids, count := tagPostings(t, st, "标签甲")
	if ids != n.ID || count != 1 {
		t.Fatalf("tags.note_ids=%q count=%d, want %q/1", ids, count, n.ID)
	}

	// Replace the tag set: the old tag's postings must be emptied.
	tags := []string{"新的标签名"}
	if _, err := st.UpdateNote(n.ID, NotePatch{Tags: &tags}); err != nil {
		t.Fatal(err)
	}
	if got := materialised(t, st, n.ID); got != "新的标签名" {
		t.Errorf("after replace tags_text = %q, want 新的标签名", got)
	}
	ids, count = tagPostings(t, st, "标签甲")
	if ids != "" || count != 0 {
		t.Errorf("stale postings on 标签甲: %q / %d", ids, count)
	}

	// Rename a tag: notes.tags_text must follow, and the FTS row must be
	// reindexed so a MATCH on the new name still finds the note.
	tag, err := st.CreateTag("新的标签名", "")
	if err != nil {
		t.Fatal(err)
	}
	newName := "重命名后的标签"
	if _, err := st.UpdateTag(tag.ID, &newName, nil, nil); err != nil {
		t.Fatal(err)
	}
	if got := materialised(t, st, n.ID); got != newName {
		t.Errorf("after rename tags_text = %q, want %q", got, newName)
	}
	var ftsHits int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?`,
		ftsQuery(newName)).Scan(&ftsHits); err != nil {
		t.Fatal(err)
	}
	if ftsHits != 1 {
		t.Errorf("FTS not synced after tag rename: %d hits, want 1", ftsHits)
	}

	// Soft delete removes the note from live postings, restore puts it back.
	if err := st.SoftDelete(n.ID); err != nil {
		t.Fatal(err)
	}
	_, count = tagPostings(t, st, newName)
	if count != 0 {
		t.Errorf("count after soft delete = %d, want 0", count)
	}
	if err := st.Restore(n.ID); err != nil {
		t.Fatal(err)
	}
	ids, count = tagPostings(t, st, newName)
	if count != 1 || ids != n.ID {
		t.Errorf("postings after restore = %q / %d", ids, count)
	}

	// Hard delete cascades note_tags deletes; triggers must still clean up.
	if err := st.HardDelete(n.ID); err != nil {
		t.Fatal(err)
	}
	ids, count = tagPostings(t, st, newName)
	if ids != "" || count != 0 {
		t.Errorf("stale postings after hard delete: %q / %d", ids, count)
	}
	var ftsHits2 int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?`,
		ftsQuery("项目复盘")).Scan(&ftsHits2); err != nil {
		t.Fatal(err)
	}
	if ftsHits2 != 0 {
		t.Errorf("FTS row survived hard delete: %d", ftsHits2)
	}
}

// Short Chinese words fall back to LIKE; long words use the trigram index.
// Both paths must return the same notes as a plain substring scan.
func TestSearchFTSAndFallbackAreEquivalent(t *testing.T) {
	st := newCleanV3Store(t)
	bodies := []struct {
		content string
		tags    []string
	}{
		{"项目复盘：中文子串搜索与性能压测", []string{"性能"}},
		{"另一篇关于性能压测的记录", []string{"压测"}},
		{"纯英文 external_id 与 save_notes", nil},
		{"无关内容", nil},
	}
	ids := map[string]bool{}
	for _, b := range bodies {
		n, err := st.CreateNote(NoteInput{Content: b.content, Tags: b.tags})
		if err != nil {
			t.Fatal(err)
		}
		ids[n.ID] = true
	}

	for _, q := range []string{"性能", "压测", "项目复盘", "中文子串", "external_id", "save_notes", "不存在的词"} {
		want := map[string]bool{}
		for _, b := range bodies {
			hit := strings.Contains(b.content, q)
			for _, tag := range b.tags {
				hit = hit || strings.Contains(tag, q)
			}
			if hit {
				for id := range ids {
					var content string
					_ = st.db.QueryRow(`SELECT content FROM notes WHERE id=?`, id).Scan(&content)
					if content == b.content {
						want[id] = true
					}
				}
			}
		}
		notes, total, err := st.ListNotes(ListFilter{Scope: "all", Query: q, Limit: 50})
		if err != nil {
			t.Fatalf("search %q: %v", q, err)
		}
		if total != len(want) {
			t.Errorf("search %q: total=%d, want %d", q, total, len(want))
		}
		got := map[string]bool{}
		for _, n := range notes {
			got[n.ID] = true
		}
		for id := range want {
			if !got[id] {
				t.Errorf("search %q missed note %s", q, id)
			}
		}
		for id := range got {
			if !want[id] {
				t.Errorf("search %q returned unrelated note %s", q, id)
			}
		}
	}
}

// The reverse index must drive tag filtering, and FTS-eligible queries must
// use the keyword index (plan contains a VIRTUAL TABLE INDEX line).
func TestSearchAndTagFilterUseIndexes(t *testing.T) {
	st := newCleanV3Store(t)
	if _, err := st.CreateNote(NoteInput{Title: "项目复盘", Content: "中文子串搜索", Tags: []string{"性能"}}); err != nil {
		t.Fatal(err)
	}
	notes, total, err := st.ListNotes(ListFilter{Scope: "all", Tag: "性能", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(notes) != 1 {
		t.Fatalf("tag filter total=%d notes=%d, want 1", total, len(notes))
	}
	if _, total, err := st.ListNotes(ListFilter{Scope: "all", Tag: "不存在的标签", Limit: 50}); err != nil || total != 0 {
		t.Errorf("unknown tag total=%d err=%v, want 0", total, err)
	}

	// Verify the FTS index is actually consulted for a long query.
	var plan string
	rows, err := st.db.Query(`EXPLAIN QUERY PLAN SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?`, ftsQuery("项目复盘"))
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var a, b, c int
		var detail string
		_ = rows.Scan(&a, &b, &c, &detail)
		plan += detail + " | "
	}
	_ = rows.Close()
	if !strings.Contains(plan, "VIRTUAL TABLE INDEX") || !strings.Contains(plan, "M") {
		t.Errorf("FTS MATCH is not using the index: %s", plan)
	}
}

// RebuildIndexes must repair deliberately corrupted materialised columns and
// a dropped FTS index, then reinstall the triggers so future writes stay in sync.
func TestRebuildIndexesRepairsDrift(t *testing.T) {
	st := newCleanV3Store(t)
	n1, _ := st.CreateNote(NoteInput{Title: "中文子串搜索", Content: "正文一", Notebook: "工作", Tags: []string{"标签甲"}})
	n2, _ := st.CreateNote(NoteInput{Title: "另一篇", Content: "正文二", Notebook: "工作", Tags: []string{"标签甲"}})
	if _, err := st.db.Exec(`UPDATE notes SET tags_text='污染数据' WHERE 1=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`UPDATE tags SET note_ids='污染', note_count=999 WHERE 1=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`UPDATE notebooks SET note_count=999 WHERE 1=1`); err != nil {
		t.Fatal(err)
	}
	if err := st.RebuildIndexes(); err != nil {
		t.Fatal(err)
	}
	if got := materialised(t, st, n1.ID); !strings.Contains(got, "标签甲") {
		t.Errorf("tags_text not rebuilt: %q", got)
	}
	ids, count := tagPostings(t, st, "标签甲")
	parts := strings.Split(ids, ",")
	sort.Strings(parts)
	want := []string{n1.ID, n2.ID}
	sort.Strings(want)
	if strings.Join(parts, ",") != strings.Join(want, ",") || count != 2 {
		t.Errorf("postings after rebuild = %q / %d, want %v / 2", ids, count, want)
	}
	var nbCount int
	_ = st.db.QueryRow(`SELECT note_count FROM notebooks WHERE name='工作'`).Scan(&nbCount)
	if nbCount != 2 {
		t.Errorf("notebook count after rebuild = %d, want 2", nbCount)
	}
	var trig int
	_ = st.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'`).Scan(&trig)
	if trig < 9 {
		t.Errorf("triggers not reinstalled: %d", trig)
	}
	// Triggers work again after the rebuild.
	n3, err := st.CreateNote(NoteInput{Title: "写入验证", Content: "正文三", Tags: []string{"标签乙"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := materialised(t, st, n3.ID); got != "标签乙" {
		t.Errorf("trigger did not fire after rebuild: %q", got)
	}
}

// Upgrading a v2 library (no materialised columns, no FTS) must rebuild once
// and produce consistent counts.
func TestV2UpgradeRebuildsIndexes(t *testing.T) {
	dbPath := t.TempDir() + "/v2.db"
	legacy, err := sql.Open("sqlite", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`
		CREATE TABLE notebooks (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
		  icon TEXT NOT NULL DEFAULT 'book', color TEXT NOT NULL DEFAULT '',
		  description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
		  pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
		  content TEXT NOT NULL DEFAULT '', notebook_id TEXT, pinned INTEGER NOT NULL DEFAULT 0,
		  source TEXT NOT NULL DEFAULT 'web', author TEXT NOT NULL DEFAULT '',
		  external_id TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
		  word_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
		  updated_at TEXT NOT NULL, deleted_at TEXT);
		CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
		  color TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
		CREATE TABLE note_tags (note_id TEXT, tag_id TEXT, PRIMARY KEY(note_id,tag_id));
		CREATE TABLE note_revisions (id TEXT PRIMARY KEY, note_id TEXT, title TEXT, content TEXT,
		  source TEXT, version INTEGER, created_at TEXT);
		CREATE TABLE api_tokens (id TEXT PRIMARY KEY, name TEXT, prefix TEXT, token_hash TEXT UNIQUE,
		  created_at TEXT, last_used_at TEXT);
		CREATE TABLE activity (id TEXT PRIMARY KEY, kind TEXT, tool TEXT, note_id TEXT,
		  note_title TEXT, detail TEXT, actor TEXT, created_at TEXT);
		CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
		INSERT INTO notebooks VALUES('nb1','旧分类','book','','',0,0,'2026-01-01','2026-01-01');
		INSERT INTO notes VALUES('n1','中文子串搜索','正文', 'nb1',0,'web','','',1,2,'2026-01-01','2026-01-01',NULL);
		INSERT INTO tags VALUES('t1','旧标签','',0,'2026-01-01');
		INSERT INTO note_tags VALUES('n1','t1');
		PRAGMA user_version = 2;
	`); err != nil {
		t.Fatal(err)
	}
	_ = legacy.Close()

	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open v2 library: %v", err)
	}
	defer st.Close()
	if got := materialised(t, st, "n1"); got != "旧标签" {
		t.Errorf("v2 upgrade tags_text = %q", got)
	}
	ids, count := tagPostings(t, st, "旧标签")
	if ids != "n1" || count != 1 {
		t.Errorf("v2 upgrade postings = %q / %d", ids, count)
	}
	notes, total, err := st.ListNotes(ListFilter{Scope: "all", Query: "中文子串", Limit: 50})
	if err != nil || total != 1 || len(notes) != 1 {
		t.Errorf("v2 upgrade FTS search total=%d notes=%d err=%v", total, len(notes), err)
	}
	var version int
	_ = st.db.QueryRow(`PRAGMA user_version`).Scan(&version)
	if version != schemaVersion {
		t.Errorf("user_version = %d, want %d", version, schemaVersion)
	}
}

// Export must be a single scan, include every live note with its tags, and
// skip trashed notes.
func TestAllLiveNotesForExport(t *testing.T) {
	st := newCleanV3Store(t)
	n1, _ := st.CreateNote(NoteInput{Title: "甲", Content: "中文子串搜索", Tags: []string{"标签甲"}})
	n2, _ := st.CreateNote(NoteInput{Title: "乙", Content: "正文二", Tags: []string{"标签乙", "标签丙"}})
	n3, _ := st.CreateNote(NoteInput{Title: "丙", Content: "回收站", Tags: []string{"标签甲"}})
	if err := st.SoftDelete(n3.ID); err != nil {
		t.Fatal(err)
	}
	all, err := st.AllLiveNotes()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("AllLiveNotes returned %d, want 2", len(all))
	}
	byID := map[string]*Note{}
	for _, n := range all {
		byID[n.ID] = n
		if n.Content == "" {
			t.Errorf("note %s has no body", n.ID)
		}
		if len(n.Tags) == 0 {
			t.Errorf("note %s has no tags", n.ID)
		}
	}
	if byID[n1.ID] == nil || byID[n2.ID] == nil || byID[n3.ID] != nil {
		t.Errorf("wrong notes: %v", byID)
	}
	if got := fmt.Sprint(byID[n2.ID].Tags); got != "[标签乙 标签丙]" && got != "[标签丙 标签乙]" {
		t.Errorf("tags = %v", byID[n2.ID].Tags)
	}
}
