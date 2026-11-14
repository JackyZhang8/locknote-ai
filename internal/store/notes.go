package store

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"locknote-mcp/internal/textutil"
)

// Note is a single note. Content is Markdown.
type Note struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Content      string     `json:"content"`
	NotebookID   string     `json:"notebookId,omitempty"`
	NotebookName string     `json:"notebook,omitempty"`
	Pinned       bool       `json:"pinned"`
	Source       string     `json:"source"`
	Author       string     `json:"author,omitempty"`
	ExternalID   string     `json:"externalId,omitempty"`
	Version      int        `json:"version"`
	WordCount    int        `json:"wordCount"`
	Tags         []string   `json:"tags"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	DeletedAt    *time.Time `json:"deletedAt,omitempty"`
	Excerpt      string     `json:"excerpt,omitempty"`
}

// NoteInput is the payload used to create or update a note. Zero values mean
// "not provided" for pointers and empty strings for the rest.
type NoteInput struct {
	Title      string   `json:"title"`
	Content    string   `json:"content"`
	Notebook   string   `json:"notebook"`   // notebook name, created on demand
	NotebookID string   `json:"notebookId"` // alternative to Notebook
	Tags       []string `json:"tags"`
	Pinned     *bool    `json:"pinned"`
	Source     string   `json:"source"`
	Author     string   `json:"author"`
	ExternalID string   `json:"externalId"`
	// IfExists controls upsert behaviour when ExternalID or Title matches an
	// existing note: "append" (default), "replace" or "skip".
	IfExists string `json:"ifExists"`
}

// ListFilter describes a note query.
type ListFilter struct {
	Scope      string // all | pinned | uncategorized | recent | trash | notebook | tag | source
	NotebookID string
	Tag        string // applies on top of Scope, case-insensitively
	Source     string
	Query      string
	Sort       string // updated | created | title
	Limit      int
	Offset     int
	WithBody   bool
}

// ---------------------------------------------------------------------------
// create / update
// ---------------------------------------------------------------------------

// CreateNote inserts a note, creating the notebook and tags on demand.
func (s *Store) CreateNote(in NoteInput) (*Note, error) {
	source := in.Source
	if source == "" {
		source = "web"
	}
	title := strings.TrimSpace(in.Title)
	content := in.Content
	if title == "" {
		title = textutil.Title(content)
	}
	if title == "" {
		title = "未命名笔记"
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// A note saved into a notebook name that does not exist yet must create it.
	// Passing create=false here silently dropped such notes into "未分类" and,
	// worse, broke UpsertNote's title+notebook idempotency (the second save no
	// longer matched the first note's notebook, so it created a duplicate).
	// MoveNote validates the note id before it calls resolveNotebook with
	// create=true, so this does not reintroduce ghost notebooks.
	nbID, nbName, err := resolveNotebook(tx, in.NotebookID, in.Notebook, true)
	if err != nil {
		return nil, err
	}

	now := nowString()
	note := &Note{
		ID:           NewID("note"),
		Title:        title,
		Content:      content,
		NotebookID:   nbID,
		NotebookName: nbName,
		Pinned:       in.Pinned != nil && *in.Pinned,
		Source:       source,
		Author:       in.Author,
		ExternalID:   in.ExternalID,
		Version:      1,
		WordCount:    textutil.WordCount(content),
		CreatedAt:    parseTime(now),
		UpdatedAt:    parseTime(now),
	}
	if _, err := tx.Exec(
		`INSERT INTO notes (id, title, content, notebook_id, pinned, source, author, external_id,
		                    version, word_count, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		note.ID, note.Title, note.Content, nullString(&note.NotebookID),
		boolInt(note.Pinned), note.Source, note.Author, note.ExternalID,
		note.Version, note.WordCount, now, now,
	); err != nil {
		return nil, fmt.Errorf("create note: %w", err)
	}

	tags, err := syncTags(tx, note.ID, in.Tags)
	if err != nil {
		return nil, err
	}
	note.Tags = tags

	if !emptyPlaceholder(note.Title, note.Content) {
		if _, err := tx.Exec(
			`INSERT INTO note_revisions (id, note_id, title, content, source, version, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			NewID("rev"), note.ID, note.Title, note.Content, note.Source, 1, now,
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	note.Excerpt = textutil.Excerpt(note.Content, 160)
	return note, nil
}

// NotePatch is a partial update. nil fields are left untouched.
type NotePatch struct {
	ForceRevision bool      `json:"-"`
	Title         *string   `json:"title"`
	Content       *string   `json:"content"`
	Notebook      *string   `json:"notebook"`
	NotebookID    *string   `json:"notebookId"`
	Tags          *[]string `json:"tags"`
	Pinned        *bool     `json:"pinned"`
	Source        string    `json:"source"`
}

// UpdateNote applies a patch and stores a revision of the previous content.
func (s *Store) UpdateNote(id string, p NotePatch) (*Note, error) {
	cur, err := s.GetNote(id)
	if err != nil {
		return nil, err
	}

	title := cur.Title
	content := cur.Content
	pinned := cur.Pinned
	nbID, nbName := cur.NotebookID, cur.NotebookName
	source := p.Source
	if source == "" {
		source = cur.Source
	}

	if p.Title != nil {
		title = strings.TrimSpace(*p.Title)
	}
	if p.Content != nil {
		content = *p.Content
	}
	if p.Pinned != nil {
		pinned = *p.Pinned
	}
	if p.NotebookID != nil || p.Notebook != nil {
		name := ""
		if p.Notebook != nil {
			name = *p.Notebook
		}
		tx, err := s.db.Begin()
		if err != nil {
			return nil, err
		}
		nb, n, err := resolveNotebook(tx, deref(p.NotebookID), name, true)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		nbID, nbName = nb, n
	}
	if title == "" {
		title = textutil.Title(content)
	}
	if title == "" {
		title = "未命名笔记"
	}

	if title == cur.Title && content == cur.Content && pinned == cur.Pinned && nbID == cur.NotebookID {
		sameTags := p.Tags == nil
		if p.Tags != nil {
			left := append([]string{}, cur.Tags...)
			right := []string{}
			seen := map[string]bool{}
			for _, tag := range *p.Tags {
				tag = strings.TrimSpace(tag)
				if tag != "" && !seen[tag] {
					right = append(right, tag)
					seen[tag] = true
				}
			}
			sort.Strings(left)
			sort.Strings(right)
			sameTags = strings.Join(left, "\x00") == strings.Join(right, "\x00")
		}
		if sameTags {
			return cur, nil
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	now := nowString()
	version := cur.Version + 1
	if _, err := tx.Exec(
		`UPDATE notes SET title = ?, content = ?, notebook_id = ?, pinned = ?, source = ?,
		        version = ?, word_count = ?, updated_at = ?
		 WHERE id = ?`,
		title, content, nullString(&nbID), boolInt(pinned), source,
		version, textutil.WordCount(content), now, id,
	); err != nil {
		return nil, fmt.Errorf("update note: %w", err)
	}

	// Only record a revision when the text actually changed; pinning or moving
	// a note should not flood the history.
	if (content != cur.Content || title != cur.Title) && !emptyPlaceholder(cur.Title, cur.Content) {
		var previousTitle, previousBody, previousTime, previousSource string
		historyErr := tx.QueryRow(`SELECT title,content,created_at,source FROM note_revisions WHERE note_id=? ORDER BY created_at DESC LIMIT 1`, id).Scan(&previousTitle, &previousBody, &previousTime, &previousSource)
		if historyErr != nil && historyErr != sql.ErrNoRows {
			return nil, historyErr
		}
		duplicate := historyErr == nil && previousTitle == cur.Title && previousBody == cur.Content
		coalesce := historyErr == nil && p.Source == "web" && previousSource == "web" && time.Since(parseTime(previousTime)) < 30*time.Second
		if !duplicate && (!coalesce || p.ForceRevision) {
			if _, err := tx.Exec(
				`INSERT INTO note_revisions (id, note_id, title, content, source, version, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				NewID("rev"), id, cur.Title, cur.Content, source, cur.Version, now,
			); err != nil {
				return nil, err
			}
		}
		// Keep the last 20 revisions per note.
		if _, err := tx.Exec(`DELETE FROM note_revisions WHERE note_id = ? AND id NOT IN (
			SELECT id FROM note_revisions WHERE note_id = ? ORDER BY created_at DESC LIMIT 20)`, id, id); err != nil {
			return nil, err
		}
	}
	var tags []string
	if p.Tags != nil {
		tags, err = syncTags(tx, id, *p.Tags)
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := s.GetNote(id)
	if err != nil {
		return nil, err
	}
	updated.NotebookName = nbName
	if p.Tags == nil {
		_ = tags
	}
	return updated, nil
}

// AppendToNote appends Markdown to an existing note, separated by a blank line.
func (s *Store) AppendToNote(id, markdown string) (*Note, error) {
	cur, err := s.GetNote(id)
	if err != nil {
		return nil, err
	}
	body := strings.TrimRight(cur.Content, "\n")
	add := strings.TrimLeft(markdown, "\n")
	next := add
	if body != "" {
		next = body + "\n\n" + add
	}
	return s.UpdateNote(id, NotePatch{Content: &next})
}

// UpsertNote implements the "save a document from an agent" flow: if a note
// with the same ExternalID exists (or same title inside the same notebook), the
// content is appended (default) or replaced instead of duplicating it.
func (s *Store) UpsertNote(in NoteInput) (*Note, bool, error) {
	existing, err := s.findExisting(in)
	if err != nil {
		return nil, false, err
	}
	if existing == nil {
		n, err := s.CreateNote(in)
		return n, true, err
	}

	mode := strings.ToLower(strings.TrimSpace(in.IfExists))
	switch mode {
	case "skip":
		full, err := s.GetNote(existing.ID)
		return full, false, err
	case "replace":
		p := NotePatch{Content: &in.Content, Source: in.Source}
		if strings.TrimSpace(in.Title) != "" {
			t := strings.TrimSpace(in.Title)
			p.Title = &t
		}
		if in.Notebook != "" || in.NotebookID != "" {
			nb := in.Notebook
			p.Notebook = &nb
		}
		if len(in.Tags) > 0 {
			tags := in.Tags
			p.Tags = &tags
		}
		n, err := s.UpdateNote(existing.ID, p)
		return n, false, err
	default:
		n, err := s.AppendToNote(existing.ID, in.Content)
		if err != nil {
			return nil, false, err
		}
		if len(in.Tags) > 0 {
			merged := append(append([]string{}, n.Tags...), in.Tags...)
			n, err = s.UpdateNote(existing.ID, NotePatch{Tags: &merged})
		}
		return n, false, err
	}
}

func (s *Store) findExisting(in NoteInput) (*Note, error) {
	if strings.TrimSpace(in.ExternalID) != "" {
		var id string
		err := s.db.QueryRow(`SELECT id FROM notes WHERE external_id = ? AND deleted_at IS NULL LIMIT 1`, in.ExternalID).Scan(&id)
		if err == nil {
			return s.GetNote(id)
		}
		if err != sql.ErrNoRows {
			return nil, err
		}
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = textutil.Title(in.Content)
	}
	if title == "" {
		return nil, nil
	}
	q := `SELECT n.id FROM notes n LEFT JOIN notebooks nb ON nb.id = n.notebook_id
	      WHERE n.deleted_at IS NULL AND lower(n.title) = lower(?)
	      AND (? = '' OR COALESCE(nb.name, '') = ?)
	      ORDER BY n.updated_at DESC LIMIT 1`
	var id string
	err := s.db.QueryRow(q, title, strings.TrimSpace(in.Notebook), strings.TrimSpace(in.Notebook)).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.GetNote(id)
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

const noteSelect = `
SELECT n.id, n.title, n.content, COALESCE(n.notebook_id, ''), COALESCE(nb.name, ''),
       n.pinned, n.source, n.author, n.external_id, n.version, n.word_count,
       n.created_at, n.updated_at, COALESCE(n.deleted_at, '')
FROM notes n LEFT JOIN notebooks nb ON nb.id = n.notebook_id`

// GetNote loads one note (including soft-deleted ones) with tags.
func (s *Store) GetNote(id string) (*Note, error) {
	row := s.db.QueryRow(noteSelect+` WHERE n.id = ?`, id)
	n, err := scanNote(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	tags, err := s.noteTags(n.ID)
	if err != nil {
		return nil, err
	}
	n.Tags = tags
	n.Excerpt = textutil.Excerpt(n.Content, 160)
	return n, nil
}

// FindNoteByTitle looks a note up by title (optionally scoped to a notebook).
func (s *Store) FindNoteByTitle(title, notebook string) (*Note, error) {
	q := noteSelect + ` WHERE n.deleted_at IS NULL AND lower(n.title) = lower(?)
		AND (? = '' OR COALESCE(nb.name, '') = ?) ORDER BY n.updated_at DESC LIMIT 1`
	row := s.db.QueryRow(q, strings.TrimSpace(title), strings.TrimSpace(notebook), strings.TrimSpace(notebook))
	n, err := scanNote(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	tags, _ := s.noteTags(n.ID)
	n.Tags = tags
	n.Excerpt = textutil.Excerpt(n.Content, 160)
	return n, nil
}

// ListNotes returns notes matching the filter plus the total row count.
func (s *Store) ListNotes(f ListFilter) ([]*Note, int, error) {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	if f.Limit > 500 {
		f.Limit = 500
	}

	where := []string{}
	args := []any{}

	switch f.Scope {
	case "trash":
		where = append(where, "n.deleted_at IS NOT NULL")
	case "pinned":
		where = append(where, "n.deleted_at IS NULL AND n.pinned = 1")
	case "uncategorized":
		where = append(where, "n.deleted_at IS NULL AND n.notebook_id IS NULL")
	case "recent":
		where = append(where, "n.deleted_at IS NULL AND n.updated_at >= ?")
		args = append(args, time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339Nano))
	case "ai":
		where = append(where, "n.deleted_at IS NULL AND n.source <> 'web'")
	case "notebook":
		where = append(where, "n.deleted_at IS NULL")
		if f.NotebookID != "" {
			where = append(where, "n.notebook_id = ?")
			args = append(args, f.NotebookID)
		} else {
			where = append(where, "n.notebook_id IS NULL")
		}
	case "tag":
		// The tag condition itself is applied below, independently of the scope,
		// so a caller can combine a tag with any scope (all, notebook, trash…).
		where = append(where, "n.deleted_at IS NULL")
	case "source":
		where = append(where, "n.deleted_at IS NULL AND n.source = ?")
		args = append(args, f.Source)
	default:
		where = append(where, "n.deleted_at IS NULL")
	}

	// Resolve the tag name to an id once, then use the reverse inverted index
	// note_tags(tag_id, note_id). The old correlated EXISTS scanned every live
	// note and looked its tags up by note_id (~236ms on 30k notes); this form
	// starts from the single tag and touches only its postings (~2ms).
	if tag := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(f.Tag), "#")); tag != "" {
		where = append(where, `n.id IN (
			SELECT nt.note_id FROM note_tags nt
			WHERE nt.tag_id IN (SELECT id FROM tags WHERE lower(name) = lower(?)))`)
		args = append(args, tag)
	}

	if q := strings.TrimSpace(f.Query); q != "" {
		if s.ftsEnabled && ftsEligible(q) {
			// Trigram phrase == substring match, but served from the keyword
			// index instead of scanning 30k note bodies.
			where = append(where, `n.rowid IN (
				SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)`)
			args = append(args, ftsQuery(q))
		} else {
			// Short Chinese words (< 3 chars) and FTS syntax characters cannot
			// use trigram. tags_text is the materialised comma-separated list,
			// so this no longer needs a correlated EXISTS per row.
			like := "%" + escapeLike(q) + "%"
			where = append(where, `(n.title LIKE ? ESCAPE '\' OR n.content LIKE ? ESCAPE '\' OR n.tags_text LIKE ? ESCAPE '\')`)
			args = append(args, like, like, like)
		}
	}

	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	// The count never references notebooks (all predicates are on n), so drop
	// the LEFT JOIN and let SQLite answer it from a covering index alone.
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM notes n`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	order := "n.updated_at DESC"
	switch f.Sort {
	case "created":
		order = "n.created_at DESC"
	case "title":
		order = "n.title COLLATE NOCASE ASC"
	case "words":
		order = "n.word_count DESC"
	}
	if f.Scope == "trash" {
		order = "n.deleted_at DESC"
	}

	q := noteSelect + clause + " ORDER BY n.pinned DESC, " + order + " LIMIT ? OFFSET ?"
	args = append(args, f.Limit, f.Offset)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	notes := []*Note{}
	ids := []string{}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, 0, err
		}
		n.Excerpt = textutil.Excerpt(n.Content, 160)
		if !f.WithBody {
			n.Content = ""
		}
		notes = append(notes, n)
		ids = append(ids, n.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	tagMap, err := s.tagsForNotes(ids)
	if err != nil {
		return nil, 0, err
	}
	for _, n := range notes {
		if t, ok := tagMap[n.ID]; ok {
			n.Tags = t
		} else {
			n.Tags = []string{}
		}
	}
	return notes, total, nil
}

// AllLiveNotes returns every non-deleted note with its body and tags, in a
// single scan ordered by creation time. Export used to loop ListNotes with a
// growing OFFSET, which re-scans and re-counts the whole table on every page
// (O(n^2): a 30k-note export effectively never finished). Tags are still
// fetched in bounded batches to keep the IN (...) list small.
func (s *Store) AllLiveNotes() ([]*Note, error) {
	rows, err := s.db.Query(noteSelect + ` WHERE n.deleted_at IS NULL ORDER BY n.created_at, n.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := []*Note{}
	ids := []string{}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		// Export only needs the raw body; computing an excerpt here would run
		// Plain()'s regex chain over every byte of every note (29 MB on the
		// stress library) for a field the caller never reads.
		notes = append(notes, n)
		ids = append(ids, n.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for start := 0; start < len(ids); start += 400 {
		end := start + 400
		if end > len(ids) {
			end = len(ids)
		}
		tagMap, err := s.tagsForNotes(ids[start:end])
		if err != nil {
			return nil, err
		}
		for _, n := range notes[start:end] {
			n.Tags = tagMap[n.ID]
			if n.Tags == nil {
				n.Tags = []string{}
			}
		}
	}
	return notes, nil
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------

// SoftDelete moves a note to the trash.
func (s *Store) SoftDelete(id string) error {
	res, err := s.db.Exec(`UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		nowString(), nowString(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Restore brings a note back from the trash.
func (s *Store) Restore(id string) error {
	res, err := s.db.Exec(`UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
		nowString(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// HardDelete removes a note permanently.
func (s *Store) HardDelete(id string) error {
	res, err := s.db.Exec(`DELETE FROM notes WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListTrashIDs returns the ids of soft-deleted notes in a stable order. The
// streamed "empty trash" endpoint uses it to report a truthful total before
// deleting anything.
func (s *Store) ListTrashIDs() ([]string, error) {
	rows, err := s.db.Query(`SELECT id FROM notes WHERE deleted_at IS NOT NULL ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// EmptyTrashOne permanently deletes ONE trashed note in its own transaction.
// The FK cascades (note_tags / note_revisions) and the v3 materialised-column
// triggers all run inside that same transaction, so one note's related rows
// are atomic while the batch as a whole is not. A cancelled batch therefore
// never leaves a half-deleted note behind, and notes already committed stay
// deleted. The deleted_at guard makes it impossible to hard-delete a live note
// if a stale id slips in.
func (s *Store) EmptyTrashOne(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.Exec(`DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// EmptyTrash permanently deletes everything in the trash, one independent
// transaction per note. It intentionally does not wrap the whole batch in a
// single transaction: a long single transaction locks the database, cannot be
// interrupted safely, and rolls back all progress on any error.
func (s *Store) EmptyTrash() (int, error) {
	ids, err := s.ListTrashIDs()
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, id := range ids {
		if err := s.EmptyTrashOne(id); err != nil {
			if err == ErrNotFound { // concurrently removed; not a failure
				continue
			}
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}

// SetPinned pins or unpins a note.
func (s *Store) SetPinned(id string, pinned bool) error {
	_, err := s.db.Exec(`UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?`, boolInt(pinned), nowString(), id)
	return err
}

// MoveNote assigns a note to a notebook (empty notebook means uncategorized).
func (s *Store) MoveNote(id, notebook string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Validate the note before resolving the notebook: resolveNotebook is called
	// with create=true, so a bad id must not leave an orphan notebook behind.
	// GetNote (and therefore the UI) can see soft-deleted notes, so match that
	// visibility here rather than filtering on deleted_at.
	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM notes WHERE id = ?`, id).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			return ErrNotFound
		}
		return err
	}

	nbID, _, err := resolveNotebook(tx, "", notebook, true)
	if err != nil {
		return err
	}
	res, err := tx.Exec(`UPDATE notes SET notebook_id = ?, updated_at = ? WHERE id = ?`,
		nullString(&nbID), nowString(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// BatchAction applies an action to many notes at once.
func (s *Store) BatchAction(ids []string, action, notebookID string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	done := 0
	for _, id := range ids {
		var err error
		switch action {
		case "delete":
			err = s.SoftDelete(id)
		case "restore":
			err = s.Restore(id)
		case "purge":
			err = s.HardDelete(id)
		case "pin":
			err = s.SetPinned(id, true)
		case "unpin":
			err = s.SetPinned(id, false)
		case "move":
			var nb string
			if notebookID != "" {
				nb = s.notebookNameByID(notebookID)
			}
			err = s.MoveNote(id, nb)
		default:
			return done, fmt.Errorf("unknown action %q", action)
		}
		if err == nil {
			done++
		}
	}
	return done, nil
}

func (s *Store) notebookNameByID(id string) string {
	var name string
	_ = s.db.QueryRow(`SELECT name FROM notebooks WHERE id = ?`, id).Scan(&name)
	return name
}

// ---------------------------------------------------------------------------
// revisions
// ---------------------------------------------------------------------------

// Revision is a stored historical version of a note.
type Revision struct {
	ID        string    `json:"id"`
	NoteID    string    `json:"noteId"`
	Title     string    `json:"title"`
	Version   int       `json:"version"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"createdAt"`
	Words     int       `json:"words"`
}

// Revisions lists stored versions for a note, newest first.
func (s *Store) Revisions(noteID string, limit int) ([]Revision, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.Query(
		`SELECT id, note_id, title, content, source, version, created_at
		 FROM note_revisions WHERE note_id = ? ORDER BY created_at DESC LIMIT ?`, noteID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Revision{}
	for rows.Next() {
		var r Revision
		var content, created string
		if err := rows.Scan(&r.ID, &r.NoteID, &r.Title, &content, &r.Source, &r.Version, &created); err != nil {
			return nil, err
		}
		r.CreatedAt = parseTime(created)
		r.Words = textutil.WordCount(content)
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRevision returns the full body of a stored revision.
func (s *Store) GetRevision(id string) (*Revision, string, error) {
	var r Revision
	var content, created string
	err := s.db.QueryRow(`SELECT id, note_id, title, content, source, version, created_at
		FROM note_revisions WHERE id = ?`, id).
		Scan(&r.ID, &r.NoteID, &r.Title, &content, &r.Source, &r.Version, &created)
	if err == sql.ErrNoRows {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	r.CreatedAt = parseTime(created)
	r.Words = textutil.WordCount(content)
	return &r, content, nil
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

func scanNote(sc interface{ Scan(...any) error }) (*Note, error) {
	var n Note
	var notebookID, notebookName, author, externalID, createdAt, updatedAt, deletedAt string
	var pinned int
	if err := sc.Scan(&n.ID, &n.Title, &n.Content, &notebookID, &notebookName,
		&pinned, &n.Source, &author, &externalID, &n.Version, &n.WordCount,
		&createdAt, &updatedAt, &deletedAt); err != nil {
		return nil, err
	}
	n.NotebookID = notebookID
	n.NotebookName = notebookName
	n.Pinned = pinned == 1
	n.Author = author
	n.ExternalID = externalID
	n.CreatedAt = parseTime(createdAt)
	n.UpdatedAt = parseTime(updatedAt)
	if deletedAt != "" {
		ts := parseTime(deletedAt)
		n.DeletedAt = &ts
	}
	if n.Tags == nil {
		n.Tags = []string{}
	}
	return &n, nil
}

func (s *Store) noteTags(noteID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
		WHERE nt.note_id = ? ORDER BY t.name`, noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (s *Store) tagsForNotes(ids []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(ids) == 0 {
		return out, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.Query(`SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
		WHERE nt.note_id IN (`+placeholders+`) ORDER BY t.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = append(out[id], name)
	}
	return out, rows.Err()
}

func syncTags(tx *sql.Tx, noteID string, names []string) ([]string, error) {
	names = sortedUnique(names)
	if _, err := tx.Exec(`DELETE FROM note_tags WHERE note_id = ?`, noteID); err != nil {
		return nil, err
	}
	for _, name := range names {
		tagID, err := ensureTag(tx, name)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)`, noteID, tagID); err != nil {
			return nil, err
		}
	}
	sort.Strings(names)
	return names, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// Empty placeholders are not useful recovery points. Raw content is checked
// rather than word count: diagrams, images and code may have zero prose words.
func emptyPlaceholder(title, content string) bool {
	title = strings.TrimSpace(title)
	return (title == "" || title == "未命名笔记") && strings.TrimSpace(content) == ""
}
