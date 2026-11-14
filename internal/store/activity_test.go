package store

import "testing"

func TestActivityOnlyIncludesMCPBeforeLimit(t *testing.T) {
	st := newTestStore(t)
	st.RecordActivity("note.created", "save_note", "mcp-note", "AI note", "", "Claude Code")
	// Simulate historical UI records that should no longer appear.
	if _, err := st.db.Exec(`INSERT INTO activity(id,kind,tool,note_id,note_title,detail,actor,created_at) VALUES('web-old','note.updated','','web-note','Local note','','web','9999')`); err != nil {
		t.Fatal(err)
	}
	items, err := st.Activity(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Tool != "save_note" {
		t.Fatalf("expected MCP entry despite newer UI row: %+v", items)
	}
	st.RecordActivity("note.updated", "", "ignored", "Local edit", "", "web")
	var count int
	if err := st.db.QueryRow(`SELECT count(*) FROM activity WHERE note_id='ignored'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("UI operation recorded in MCP feed")
	}
}
