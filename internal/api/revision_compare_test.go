package api

import (
	"fmt"
	"locknote-mcp/internal/store"
	"testing"
)

func TestRevisionRestoreRequiresCurrentVersion(t *testing.T) {
	s := settingsServer(t)
	note, err := s.store.CreateNote(store.NoteInput{Title: "Original", Content: "old"})
	if err != nil {
		t.Fatal(err)
	}
	body := "new"
	note, err = s.store.UpdateNote(note.ID, store.NotePatch{Content: &body, ForceRevision: true})
	if err != nil {
		t.Fatal(err)
	}
	revs, err := s.store.Revisions(note.ID, 20)
	if err != nil || len(revs) == 0 {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/notes/%s/revisions/%s/restore", note.ID, revs[0].ID)
	for _, tc := range []struct {
		body   string
		status int
	}{{`{}`, 400}, {`{"expectedVersion":1}`, 409}, {fmt.Sprintf(`{"expectedVersion":%d}`, note.Version), 200}} {
		result := pluginRequest(s, "POST", path, tc.body, "")
		if result.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.body, result.Code, result.Body.String())
		}
	}
}

func TestRestoreCheckpointAndUndoPreserveLaterEdits(t *testing.T) {
	s := settingsServer(t)
	note, err := s.store.CreateNote(store.NoteInput{Title: "Title", Content: "before"})
	if err != nil {
		t.Fatal(err)
	}
	before := "edited"
	note, err = s.store.UpdateNote(note.ID, store.NotePatch{Content: &before, ForceRevision: true})
	if err != nil {
		t.Fatal(err)
	}
	revs, _ := s.store.Revisions(note.ID, 20)
	path := fmt.Sprintf("/api/notes/%s/revisions/%s/restore", note.ID, revs[0].ID)
	response := pluginRequest(s, "POST", path, fmt.Sprintf(`{"expectedVersion":%d}`, note.Version), "")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	restored, _ := s.store.GetNote(note.ID)
	checkpoints, _ := s.store.Revisions(note.ID, 20)
	found := false
	for _, r := range checkpoints {
		_, body, _ := s.store.GetRevision(r.ID)
		if body == "edited" {
			found = true
		}
	}
	if !found {
		t.Fatal("restore lost prior checkpoint")
	}
	later := "user later"
	s.store.UpdateNote(note.ID, store.NotePatch{Content: &later})
	response = pluginRequest(s, "PATCH", "/api/notes/"+note.ID+"?checkpoint=true", fmt.Sprintf(`{"content":"edited","expectedVersion":%d}`, restored.Version), "")
	if response.Code != 409 {
		t.Fatalf("undo stale status %d", response.Code)
	}
	actual, _ := s.store.GetNote(note.ID)
	if actual.Content != "user later" {
		t.Fatal("later edit overwritten")
	}
}
