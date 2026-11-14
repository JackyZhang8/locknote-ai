package store

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestExportSnapshotBatchesAndConcurrentWrites(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.db.Exec("DELETE FROM notes"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 260; i++ {
		if _, err := st.db.Exec("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)", NewID("n"), "title", "body", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	old, err := st.CreateNote(NoteInput{Title: "snapshot", Content: "original", Tags: []string{"old-tag"}})
	if err != nil {
		t.Fatal(err)
	}
	exp, err := st.OpenNoteExport(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer exp.Close()
	if exp.Count != 261 {
		t.Fatalf("count %d", exp.Count)
	}
	// Holding the export snapshot must not reserve the application's sole connection.
	done := make(chan error, 1)
	go func() {
		body := "changed"
		tags := []string{"new-tag"}
		_, err := st.UpdateNote(old.ID, NotePatch{Content: &body, Tags: &tags})
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("export blocked editing")
	}
	if _, err := st.CreateNote(NoteInput{Title: "after snapshot", Content: "new"}); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	found := false
	for {
		batch, err := exp.NextBatch(context.Background())
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if len(batch) == 0 || len(batch) > 128 {
			t.Fatalf("batch size %d", len(batch))
		}
		for _, note := range batch {
			if seen[note.ID] {
				t.Fatalf("duplicate %s", note.ID)
			}
			seen[note.ID] = true
			if note.ID == old.ID {
				found = true
				if note.Content != "original" || strings.Join(note.Tags, ",") != "old-tag" {
					t.Fatalf("inconsistent snapshot %+v", note)
				}
			}
		}
	}
	if len(seen) != 261 || !found {
		t.Fatalf("exported %d, found=%v", len(seen), found)
	}
}

func TestExportBatchByteBudgetAndCancellation(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.db.Exec("DELETE FROM notes"); err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("x", 3<<20)
	for i := 0; i < 4; i++ {
		if _, err := st.db.Exec("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)", NewID("n"), "large", body, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	exp, err := st.OpenNoteExport(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer exp.Close()
	batch, err := exp.NextBatch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 2 {
		t.Fatalf("byte budget did not bound batch: %d", len(batch))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := exp.NextBatch(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	if err := exp.Close(); err != nil {
		t.Fatal(err)
	}
	if err := exp.Close(); err != nil {
		t.Fatal(err)
	}
}
