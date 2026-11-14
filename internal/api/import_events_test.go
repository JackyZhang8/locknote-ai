package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestImportPublishesOneCompletionEvent(t *testing.T) {
	s := settingsServer(t)
	ch := s.hub.subscribe()
	defer s.hub.unsubscribe(ch)
	req := httptest.NewRequest("POST", "/api/import", strings.NewReader(
		`{"files":[{"name":"one.md","content":"# one"},{"name":"two.md","content":"# two"}]}`))
	rec := httptest.NewRecorder()
	s.handleImportMarkdown(rec, req)
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	if len(ch) != 1 {
		t.Fatalf("got %d events, want one completion event", len(ch))
	}
	if event := <-ch; event.Type != "notes.imported" {
		t.Fatalf("event: %+v", event)
	}
	// Reimporting unchanged notes must not refresh every client.
	s.handleImportMarkdown(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/import", strings.NewReader(
		`{"files":[{"name":"one.md","content":"# one"},{"name":"two.md","content":"# two"}]}`)))
	if len(ch) != 0 {
		t.Fatalf("unchanged import emitted %d events", len(ch))
	}
}
