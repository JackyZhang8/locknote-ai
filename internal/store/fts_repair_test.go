package store

import (
	"path/filepath"
	"testing"
)

func TestExplicitMaintenanceRepairsStaleFTS(t *testing.T) {
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
	if _, err = st.RepairIndexesWithBackup(); err != nil {
		t.Fatal(err)
	}
	text := "A new searchable body"
	if _, err = st.UpdateNote(n.ID, NotePatch{Content: &text}); err != nil {
		t.Fatalf("update after reopen: %v", err)
	}
	if _, err = st.db.Exec(`INSERT INTO notes_fts(notes_fts,rank) VALUES('integrity-check',1)`); err != nil {
		t.Fatal(err)
	}
}

func TestHealthyReopenDoesNotWriteFTS(t *testing.T) {
	path := filepath.Join(t.TempDir(), "normal.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	st.Close()
	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var changes int
	if err = st.db.QueryRow("SELECT total_changes()").Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if changes != 0 {
		t.Fatalf("normal reopen performed %d writes; use explicit maintenance", changes)
	}
}
