package store

import (
	"path/filepath"
	"testing"
)

func TestOpenRepairsStaleFTS(t *testing.T) {
	path := filepath.Join(t.TempDir(), "repair.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	n, err := st.CreateNote(NoteInput{Title: "Original searchable title", Content: "Original searchable body"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.db.Exec(dropTriggersSQL); err != nil {
		t.Fatal(err)
	}
	if _, err = st.db.Exec(`UPDATE notes SET content='Changed without index' WHERE id=?`, n.ID); err != nil {
		t.Fatal(err)
	}
	st.Close()
	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	text := "A new searchable body"
	if _, err = st.UpdateNote(n.ID, NotePatch{Content: &text}); err != nil {
		t.Fatalf("update after reopen: %v", err)
	}
	if _, err = st.db.Exec(`INSERT INTO notes_fts(notes_fts,rank) VALUES('integrity-check',1)`); err != nil {
		t.Fatal(err)
	}
}
