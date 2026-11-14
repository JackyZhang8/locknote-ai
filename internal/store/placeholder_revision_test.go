package store

import "testing"

func TestPlaceholderDoesNotCreateHistory(t *testing.T) {
	st := newTestStore(t)
	n, err := st.CreateNote(NoteInput{})
	if err != nil {
		t.Fatal(err)
	}
	check := func(want int) {
		t.Helper()
		r, err := st.Revisions(n.ID, 20)
		if err != nil {
			t.Fatal(err)
		}
		if len(r) != want {
			t.Fatalf("history=%d want %d", len(r), want)
		}
	}
	check(0)
	body := "First real content"
	if _, err = st.UpdateNote(n.ID, NotePatch{Content: &body}); err != nil {
		t.Fatal(err)
	}
	check(0)
	body = "Second content"
	if _, err = st.UpdateNote(n.ID, NotePatch{Content: &body}); err != nil {
		t.Fatal(err)
	}
	check(1)
}
func TestMeaningfulEmptyCountNotesKeepHistory(t *testing.T) {
	st := newTestStore(t)
	for _, in := range []NoteInput{{Title: "Named draft"}, {Title: "未命名笔记", Content: "![diagram](x.png)"}} {
		n, err := st.CreateNote(in)
		if err != nil {
			t.Fatal(err)
		}
		r, err := st.Revisions(n.ID, 20)
		if err != nil || len(r) != 1 {
			t.Fatalf("meaningful draft lost history: %v %v", r, err)
		}
	}
}
