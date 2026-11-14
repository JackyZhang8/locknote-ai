package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"locknote-mcp/internal/store"
)

func settingsServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(Config{Store: st})
}

// A name clash is a no-op: REST must not answer 201 Created nor broadcast a
// notebook.changed event for a write that never happened.
func TestCreateNotebookIdempotentReturnsOK(t *testing.T) {
	s := settingsServer(t)

	rec := httptest.NewRecorder()
	s.handleCreateNotebook(rec, httptest.NewRequest("POST", "/api/notebooks",
		strings.NewReader(`{"name":"收集箱","description":"这段说明不应被写入"}`)))
	if rec.Code != http.StatusOK {
		t.Errorf("existing notebook status = %d, want 200", rec.Code)
	}
	nb, err := s.store.GetNotebookByName("收集箱")
	if err != nil {
		t.Fatal(err)
	}
	if nb.Description == "这段说明不应被写入" {
		t.Error("idempotent create must not rewrite the description")
	}

	fresh := httptest.NewRecorder()
	s.handleCreateNotebook(fresh, httptest.NewRequest("POST", "/api/notebooks",
		strings.NewReader(`{"name":"全新笔记本"}`)))
	if fresh.Code != http.StatusCreated {
		t.Errorf("new notebook status = %d, want 201", fresh.Code)
	}
}

func TestExportOnlyMarkdown(t *testing.T) {
	s := settingsServer(t)
	if _, _, err := s.store.CreateNotebook("工作", "book", "", ""); err != nil {
		t.Fatal(err)
	}
	note, err := s.store.CreateNote(store.NoteInput{Title: "导出测试", Content: "# 正文\n\n保留内容", Notebook: "工作", Tags: []string{"测试"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"json", "xml"} {
		rec := httptest.NewRecorder()
		s.handleExportAll(rec, httptest.NewRequest("GET", "/api/export?format="+format, nil))
		if rec.Code != 400 {
			t.Errorf("%s export status = %d, want 400", format, rec.Code)
		}
	}
	for _, format := range []string{"", "markdown"} {
		rec := httptest.NewRecorder()
		s.handleExportAll(rec, httptest.NewRequest("GET", "/api/export?format="+format, nil))
		if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/zip" {
			t.Fatalf("Markdown export: %d", rec.Code)
		}
		archive, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, f := range archive.File {
			if !strings.HasSuffix(f.Name, ".md") {
				t.Errorf("unexpected export file: %s", f.Name)
			}
			if strings.HasPrefix(f.Name, "notes/") {
				r, err := f.Open()
				if err != nil {
					t.Fatal(err)
				}
				content, err := io.ReadAll(r)
				_ = r.Close()
				if err != nil {
					t.Fatal(err)
				}
				title, notebook, tags, body := parseMarkdownImport(f.Name, string(content))
				if title == note.Title {
					found = true
					if notebook != "工作" || strings.Join(tags, ",") != "测试" || body != note.Content {
						t.Fatalf("Markdown import did not preserve note: %q %q %v %q", title, notebook, tags, body)
					}
				}
			}
		}
		if !found {
			t.Fatal("export missing test note")
		}
	}
}

func TestColorPreferencesPersist(t *testing.T) {
	s := settingsServer(t)
	for _, color := range []string{"green", "coral", "sunset", "blue", "lavender"} {
		rec := httptest.NewRecorder()
		s.handlePutSettings(rec, httptest.NewRequest("PUT", "/api/settings", strings.NewReader(`{"theme":"`+color+`"}`)))
		if rec.Code != 200 {
			t.Errorf("save %s: %d", color, rec.Code)
		}
		if got := s.readSettings()["theme"]; got != color {
			t.Errorf("theme = %s, want %s", got, color)
		}
	}
	for _, old := range []string{"system", "light", "dark"} {
		_ = s.store.SetSetting("ui.theme", old)
		if got := s.readSettings()["theme"]; got != "green" {
			t.Errorf("legacy %s resolved to %s", old, got)
		}
	}
}

// seedTrash creates `n` soft-deleted notes plus one live note, all sharing a
// tag so the v3 materialised postings are exercised too.
func seedTrash(t *testing.T, s *Server, n int) *store.Note {
	t.Helper()
	for i := 0; i < n; i++ {
		note, err := s.store.CreateNote(store.NoteInput{
			Title: fmt.Sprintf("回收站 %d", i), Content: "正文", Tags: []string{"共用标签"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := s.store.SoftDelete(note.ID); err != nil {
			t.Fatal(err)
		}
	}
	live, err := s.store.CreateNote(store.NoteInput{
		Title: "仍在使用的笔记", Content: "正文", Tags: []string{"共用标签"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return live
}

// Emptying the trash must be a series of per-note transactions: stopping after
// two deletions leaves the other notes (and the live note) untouched.
func TestEmptyTrashIsOneTransactionPerNote(t *testing.T) {
	s := settingsServer(t)
	live := seedTrash(t, s, 4)

	ids, err := s.store.ListTrashIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 4 {
		t.Fatalf("trash ids = %d, want 4", len(ids))
	}
	for _, id := range ids[:2] {
		if err := s.store.EmptyTrashOne(id); err != nil {
			t.Fatal(err)
		}
	}
	left, err := s.store.ListTrashIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 2 {
		t.Fatalf("after 2 deletions trash = %d, want 2", len(left))
	}
	if _, err := s.store.GetNote(live.ID); err != nil {
		t.Fatalf("live note was deleted: %v", err)
	}
	// A live id must never be hard-deletable through this path.
	if err := s.store.EmptyTrashOne(live.ID); err != store.ErrNotFound {
		t.Fatalf("live note guard: got %v, want ErrNotFound", err)
	}
	tags, err := s.store.ListTags()
	if err != nil {
		t.Fatal(err)
	}
	// store.Open seeds welcome notes (and their tags), so look up our tag by
	// name rather than assuming it is the only one in the database.
	var sharedCount = -1
	for _, tag := range tags {
		if tag.Name == "共用标签" {
			sharedCount = tag.Count
		}
	}
	if sharedCount != 1 {
		t.Fatalf("tag postings drifted: 共用标签 count = %d, want 1 (all tags: %+v)", sharedCount, tags)
	}

	// EmptyTrash itself also works one transaction at a time.
	n, err := s.store.EmptyTrash()
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("EmptyTrash deleted %d, want 2", n)
	}
	if rest, err := s.store.ListTrashIDs(); err != nil || len(rest) != 0 {
		t.Fatalf("trash not empty: %v %v", rest, err)
	}
	if _, err := s.store.GetNote(live.ID); err != nil {
		t.Fatalf("live note lost: %v", err)
	}
}

func TestEmptyTrashStreamEmitsProgress(t *testing.T) {
	s := settingsServer(t)
	seedTrash(t, s, 3)

	rec := httptest.NewRecorder()
	s.handleEmptyTrashStream(rec, httptest.NewRequest("POST", "/api/trash/empty-stream", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/x-ndjson") {
		t.Errorf("content type = %q", ct)
	}
	lines := strings.Split(strings.TrimSpace(rec.Body.String()), "\n")
	if len(lines) != 5 {
		t.Fatalf("lines = %d, want start + 3 progress + done: %q", len(lines), rec.Body.String())
	}
	var first, last trashProgress
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &last); err != nil {
		t.Fatal(err)
	}
	if first.Total != 3 || first.Remaining != 3 {
		t.Errorf("start line = %+v", first)
	}
	if !last.Done || last.Deleted != 3 || last.Remaining != 0 {
		t.Errorf("final line = %+v", last)
	}
	if ids, err := s.store.ListTrashIDs(); err != nil || len(ids) != 0 {
		t.Fatalf("trash not emptied: %v %v", ids, err)
	}
}

// The whole point of per-note transactions: if the browser aborts, notes
// already committed stay deleted and the rest stay in the trash.
func TestEmptyTrashProgressStopsWhenClientDisconnects(t *testing.T) {
	s := settingsServer(t)
	seedTrash(t, s, 5)
	ids, err := s.store.ListTrashIDs()
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	state := s.emptyTrashProgress(context.Background(), ids, func(trashProgress) bool {
		calls++
		return calls < 2 // write fails after the second note
	})
	if !state.Cancelled || state.Done {
		t.Errorf("state = %+v, want cancelled", state)
	}
	if state.Deleted != 2 || state.Remaining != 3 {
		t.Errorf("deleted/remaining = %d/%d, want 2/3", state.Deleted, state.Remaining)
	}
	left, err := s.store.ListTrashIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 3 {
		t.Errorf("trash after cancel = %d, want 3 (no rollback of committed deletes)", len(left))
	}
}

func TestEmptyTrashProgressStopsOnCancelledContext(t *testing.T) {
	s := settingsServer(t)
	seedTrash(t, s, 3)
	ids, err := s.store.ListTrashIDs()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	state := s.emptyTrashProgress(ctx, ids, func(trashProgress) bool { return true })
	if !state.Cancelled || state.Deleted != 0 {
		t.Errorf("state = %+v, want cancelled with 0 deletions", state)
	}
	left, err := s.store.ListTrashIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 3 {
		t.Errorf("trash = %d, want 3", len(left))
	}
}
