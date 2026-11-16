package store

import (
	"errors"
	"testing"
)

func TestConditionalPluginUpdateRejectsStaleRevision(t *testing.T) {
	st := newTestStore(t)
	note, err := st.CreateNote(NoteInput{Title: "Original", Content: "First"})
	if err != nil {
		t.Fatal(err)
	}
	expected := note.Version
	text := "Plugin version"
	updated, err := st.UpdateNote(note.ID, NotePatch{Content: &text, Source: "plugin:example", ExpectedVersion: &expected, ForceRevision: true})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != expected+1 || updated.Source != "plugin:example" {
		t.Fatalf("unexpected update: %+v", updated)
	}
	stale := "Must not overwrite"
	_, err = st.UpdateNote(note.ID, NotePatch{Content: &stale, ExpectedVersion: &expected})
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale write error=%v", err)
	}
	current, _ := st.GetNote(note.ID)
	if current.Content != text {
		t.Fatal("stale plugin overwrote current note")
	}
	// A stale no-op also must report conflict instead of implying success.
	_, err = st.UpdateNote(note.ID, NotePatch{Content: &text, ExpectedVersion: &expected})
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale no-op error=%v", err)
	}
}

func TestConditionalPluginUpdateCannotModifyTrash(t *testing.T) {
	st := newTestStore(t)
	note, err := st.CreateNote(NoteInput{Title: "Trash", Content: "Keep"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDelete(note.ID); err != nil {
		t.Fatal(err)
	}
	body := "Changed"
	_, err = st.UpdateNote(note.ID, NotePatch{Content: &body, ExpectedVersion: &note.Version, Source: "plugin:test"})
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("trash update error = %v", err)
	}
	current, _ := st.GetNote(note.ID)
	if current.Content != "Keep" {
		t.Fatal("plugin changed trashed note")
	}
}

func TestPluginNotesAreNotClassifiedAsAI(t *testing.T) {
	st := newTestStore(t)
	_, err := st.CreateNote(NoteInput{Title: "Plugin", Content: "Content", Source: "plugin:dev.test"})
	if err != nil {
		t.Fatal(err)
	}
	notes, _, err := st.ListNotes(ListFilter{Scope: "ai"})
	if err != nil {
		t.Fatal(err)
	}
	for _, note := range notes {
		if note.Source == "plugin:dev.test" {
			t.Fatal("plugin note appears in AI scope")
		}
	}
	before, err := st.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.CreateNote(NoteInput{Title: "Another plugin note", Content: "Content", Source: "plugin:dev.test"})
	if err != nil {
		t.Fatal(err)
	}
	after, err := st.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	if after.FromAI != before.FromAI {
		t.Fatal("plugin write incremented AI counter")
	}
}
