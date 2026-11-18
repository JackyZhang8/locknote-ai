package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepairPreservesApplicationRecords(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(filepath.Join(dir, "preserve.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	note, err := st.CreateNote(NoteInput{Title: "Preserve records", Content: "original", Notebook: "Safety notebook", Tags: []string{"safety"}})
	if err != nil {
		t.Fatal(err)
	}
	content := "revised content"
	if _, err = st.UpdateNote(note.ID, NotePatch{Content: &content}); err != nil {
		t.Fatal(err)
	}
	tokenFile := filepath.Join(dir, "token")
	token, err := st.EnsureGlobalToken(tokenFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.db.Exec("INSERT OR REPLACE INTO settings(key,value) VALUES('safety-probe','preserve')"); err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		data := make(map[string][][]any)
		for _, table := range []string{"notes", "notebooks", "tags", "note_tags", "note_revisions", "api_tokens", "settings"} {
			rows, err := st.db.Query("SELECT * FROM " + table + " ORDER BY 1")
			if err != nil {
				t.Fatal(err)
			}
			columns, _ := rows.Columns()
			for rows.Next() {
				values := make([]any, len(columns))
				targets := make([]any, len(columns))
				for i := range values {
					targets[i] = &values[i]
				}
				if err := rows.Scan(targets...); err != nil {
					t.Fatal(err)
				}
				data[table] = append(data[table], values)
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			rows.Close()
		}
		raw, err := json.Marshal(data)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	before := snapshot()
	if _, err = st.RepairIndexesWithBackup(); err != nil {
		t.Fatal(err)
	}
	if after := snapshot(); after != before {
		t.Fatal("repair altered application records")
	}
	raw, err := os.ReadFile(tokenFile)
	if err != nil || strings.TrimSpace(string(raw)) != token {
		t.Fatal("repair altered token file", err)
	}
}

func TestMaintenanceChecksAndBacksUpBeforeRepair(t *testing.T) {
	path := filepath.Join(t.TempDir(), "maintenance.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	note, err := st.CreateNote(NoteInput{Title: "Preserve searchable note", Content: "Original content", Tags: []string{"keep"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.db.Exec(dropTriggersSQL); err != nil {
		t.Fatal(err)
	}
	if _, err = st.db.Exec("UPDATE notes SET content='Changed content' WHERE id=?", note.ID); err != nil {
		t.Fatal(err)
	}
	if err = st.CheckDatabase(); err == nil {
		t.Fatal("stale FTS must be detected explicitly")
	}
	backup, err := st.RepairIndexesWithBackup()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(backup); err != nil {
		t.Fatal(err)
	}
	if err = st.CheckDatabase(); err != nil {
		t.Fatal(err)
	}
	var content string
	if err = st.db.QueryRow("SELECT content FROM notes WHERE id=?", note.ID).Scan(&content); err != nil || content != "Changed content" {
		t.Fatalf("note changed: %q %v", content, err)
	}
	before, err := openMaintenance(backup)
	if err != nil {
		t.Fatal(err)
	}
	defer before.Close()
	if err = before.db.QueryRow("SELECT content FROM notes WHERE id=?", note.ID).Scan(&content); err != nil || content != "Changed content" {
		t.Fatal("backup omitted committed WAL data", err)
	}
}

func TestMissingFTSIsRebuiltWithoutChangingNotes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	note, err := st.CreateNote(NoteInput{Title: "Unique searchable title", Content: "must survive missing index"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.db.Exec("DROP TABLE notes_fts"); err != nil {
		t.Fatal(err)
	}
	st.Close()
	st, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err = st.CheckDatabase(); err != nil {
		t.Fatal(err)
	}
	var content string
	if err = st.db.QueryRow("SELECT content FROM notes WHERE id=?", note.ID).Scan(&content); err != nil || content != "must survive missing index" {
		t.Fatal(content, err)
	}
}
