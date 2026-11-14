package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"locknote-mcp/internal/store"
)

func TestNoteTagsCanBeAssignedReplacedAndCleared(t *testing.T) {
	s := settingsServer(t)
	note, err := s.store.CreateNote(store.NoteInput{Title: "标签测试", Content: "正文"})
	if err != nil {
		t.Fatal(err)
	}
	for _, names := range [][]string{{"工作", "项目"}, {"项目"}, {}} {
		body, _ := json.Marshal(map[string]any{"tags": names})
		req := httptest.NewRequest("PATCH", "/api/notes/"+note.ID, strings.NewReader(string(body)))
		req.SetPathValue("id", note.ID)
		rec := httptest.NewRecorder()
		s.handleUpdateNote(rec, req)
		if rec.Code != 200 {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}
		updated, err := s.store.GetNote(note.ID)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(updated.Tags, ",") != strings.Join(names, ",") {
			t.Fatalf("tags = %v, want %v", updated.Tags, names)
		}
		if updated.Content != "正文" {
			t.Fatal("tag update changed content")
		}
	}
	tags, err := s.store.ListTags()
	if err != nil {
		t.Fatal(err)
	}
	for _, tag := range tags {
		if (tag.Name == "工作" || tag.Name == "项目") && tag.Count != 0 {
			t.Fatalf("stale count: %+v", tag)
		}
	}
}
