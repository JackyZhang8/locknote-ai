package store

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/url"
	"path/filepath"
	"strings"
)

const exportBatchNotes = 128
const exportBatchBytes = 4 << 20

// NoteExport owns an independent read-only WAL snapshot. It must be closed,
// and NextBatch must only be called by one goroutine at a time.
type NoteExport struct {
	Count    int
	db       *sql.DB
	tx       *sql.Tx
	after    int64
	finished bool
}

func (s *Store) OpenNoteExport(ctx context.Context) (*NoteExport, error) {
	absolute, err := filepath.Abs(s.path)
	if err != nil {
		return nil, err
	}
	location := url.URL{Scheme: "file", Path: absolute}
	options := url.Values{}
	options.Set("mode", "ro")
	options.Add("_pragma", "query_only(1)")
	options.Add("_pragma", "busy_timeout(5000)")
	location.RawQuery = options.Encode()
	db, err := sql.Open("sqlite", location.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		db.Close()
		return nil, err
	}
	out := &NoteExport{db: db, tx: tx}
	// The first read fixes the snapshot before any response headers are sent.
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL").Scan(&out.Count); err != nil {
		out.Close()
		return nil, err
	}
	return out, nil
}

func (e *NoteExport) Close() error {
	if e.db == nil {
		return nil
	}
	err := e.tx.Rollback()
	if errors.Is(err, sql.ErrTxDone) {
		err = nil
	}
	closeErr := e.db.Close()
	e.db = nil
	if err != nil {
		return err
	}
	return closeErr
}

type exportScanner struct {
	rows  *sql.Rows
	rowid *int64
}

func (s exportScanner) Scan(dest ...any) error {
	return s.rows.Scan(append([]any{s.rowid}, dest...)...)
}

// NextBatch has a soft byte budget: one oversized note is never truncated.
// Rowid is immutable for this snapshot and avoids OFFSET rescanning.
func (e *NoteExport) NextBatch(ctx context.Context) ([]*Note, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if e.db == nil {
		return nil, sql.ErrTxDone
	}
	if e.finished {
		return nil, io.EOF
	}
	query := strings.Replace(noteSelect, "SELECT n.id", "SELECT n.rowid, n.id", 1) +
		" WHERE n.deleted_at IS NULL AND n.rowid > ? ORDER BY n.rowid LIMIT ?"
	rows, err := e.tx.QueryContext(ctx, query, e.after, exportBatchNotes)
	if err != nil {
		return nil, err
	}
	notes := make([]*Note, 0, exportBatchNotes)
	size := 0
	for rows.Next() {
		note, err := scanNote(exportScanner{rows, &e.after})
		if err != nil {
			rows.Close()
			return nil, err
		}
		notes = append(notes, note)
		size += len(note.Content)
		if size >= exportBatchBytes {
			break
		}
	}
	err = rows.Err()
	closeErr := rows.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if len(notes) == 0 {
		e.finished = true
		return nil, io.EOF
	}
	args := make([]any, len(notes))
	byID := make(map[string]*Note, len(notes))
	for i, note := range notes {
		args[i] = note.ID
		note.Tags = []string{}
		byID[note.ID] = note
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(notes)), ",")
	tags, err := e.tx.QueryContext(ctx, "SELECT nt.note_id,t.name FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id IN ("+placeholders+") ORDER BY t.name", args...)
	if err != nil {
		return nil, err
	}
	defer tags.Close()
	for tags.Next() {
		var id, name string
		if err := tags.Scan(&id, &name); err != nil {
			return nil, err
		}
		byID[id].Tags = append(byID[id].Tags, name)
	}
	if err := tags.Err(); err != nil {
		return nil, err
	}
	return notes, nil
}
