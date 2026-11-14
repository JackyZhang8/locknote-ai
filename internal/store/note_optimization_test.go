package store

import "testing"

func TestNoopAndContinuousHistory(t *testing.T) {
	st := newTestStore(t)
	n, err := st.CreateNote(NoteInput{Title: "Draft", Content: "A"})
	if err != nil {
		t.Fatal(err)
	}
	same, err := st.UpdateNote(n.ID, NotePatch{Content: &n.Content, Source: "web"})
	if err != nil {
		t.Fatal(err)
	}
	if same.Version != n.Version || !same.UpdatedAt.Equal(n.UpdatedAt) {
		t.Fatal("no-op mutated note")
	}
	for _, value := range []string{"B", "C", "D"} {
		if _, err := st.UpdateNote(n.ID, NotePatch{Content: &value, Source: "web"}); err != nil {
			t.Fatal(err)
		}
	}
	history, err := st.Revisions(n.ID, 20)
	if err != nil || len(history) != 1 {
		t.Fatalf("history=%d %v", len(history), err)
	}
}
func TestDraftCleanupGuards(t *testing.T) {
	st := newTestStore(t)
	blank, _ := st.CreateNote(NoteInput{})
	named, _ := st.CreateNote(NoteInput{Title: "Keep me"})
	if err := st.DiscardPlaceholder(blank.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetNote(blank.ID); err != ErrNotFound {
		t.Fatal("blank draft remains")
	}
	st.DiscardPlaceholder(named.ID)
	if _, err := st.GetNote(named.ID); err != nil {
		t.Fatal("named draft deleted")
	}
}
func TestImportDuplicatePolicies(t *testing.T) {
	st := newTestStore(t)
	in := NoteInput{Title: "Import example", Content: "A"}
	original, _, _, err := st.ImportNote(in, "skip")
	if err != nil {
		t.Fatal(err)
	}
	in.Content = "B"
	_, _, skip, err := st.ImportNote(in, "skip")
	if err != nil || !skip {
		t.Fatal("skip failed")
	}
	replaced, created, skip, err := st.ImportNote(in, "replace")
	if err != nil || created || skip || replaced.ID != original.ID || replaced.Content != "B" {
		t.Fatal("replace failed")
	}
	copied, created, _, err := st.ImportNote(in, "copy")
	if err != nil || !created || copied.ID == original.ID {
		t.Fatal("copy failed")
	}
}
