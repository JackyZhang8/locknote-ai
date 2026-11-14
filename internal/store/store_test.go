package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestCreateNoteDerivesTitleAndCountsWords(t *testing.T) {
	st := newTestStore(t)

	n, err := st.CreateNote(NoteInput{
		Content:  "# 项目复盘\n\n这一版把笔记和 AI 放在同一个库里，AI 通过 MCP 直接读写。",
		Notebook: "工作项目",
		Tags:     []string{"复盘", "架构"},
	})
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	if n.Title != "项目复盘" {
		t.Errorf("title = %q, want 项目复盘", n.Title)
	}
	if n.NotebookName != "工作项目" {
		t.Errorf("notebook = %q, want 工作项目", n.NotebookName)
	}
	if len(n.Tags) != 2 {
		t.Errorf("tags = %v, want 2 tags", n.Tags)
	}
	if n.WordCount == 0 {
		t.Error("word count should not be zero")
	}
	if n.Source != "web" {
		t.Errorf("source = %q, want web", n.Source)
	}
	if n.Excerpt == "" {
		t.Error("excerpt should be derived from content")
	}
}

func TestUpsertByExternalID(t *testing.T) {
	st := newTestStore(t)

	first, created, err := st.UpsertNote(NoteInput{
		Title:      "架构说明",
		Content:    "v1",
		ExternalID: "locknote-mcp/architecture",
		Source:     "mcp",
		IfExists:   "replace",
	})
	if err != nil || !created {
		t.Fatalf("first upsert: created=%v err=%v", created, err)
	}

	second, created, err := st.UpsertNote(NoteInput{
		Content:    "v2",
		ExternalID: "locknote-mcp/architecture",
		Source:     "mcp",
		IfExists:   "replace",
	})
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if created {
		t.Error("second upsert should update, not create")
	}
	if second.ID != first.ID {
		t.Errorf("id changed: %s -> %s", first.ID, second.ID)
	}
	if second.Content != "v2" {
		t.Errorf("content = %q, want v2", second.Content)
	}
	if second.Title != "架构说明" {
		t.Errorf("title should be preserved, got %q", second.Title)
	}
	if second.Version <= first.Version {
		t.Errorf("version should increase: %d -> %d", first.Version, second.Version)
	}

	// A third upsert with if_exists=append should keep both versions.
	third, _, err := st.UpsertNote(NoteInput{
		Content:    "v3",
		ExternalID: "locknote-mcp/architecture",
		Source:     "mcp",
		IfExists:   "append",
	})
	if err != nil {
		t.Fatalf("append upsert: %v", err)
	}
	if !strings.Contains(third.Content, "v2") || !strings.Contains(third.Content, "v3") {
		t.Errorf("append should keep both bodies, got %q", third.Content)
	}
}

func TestListNotesScopesAndSearch(t *testing.T) {
	st := newTestStore(t)

	pinned := true
	if _, err := st.CreateNote(NoteInput{Title: "置顶笔记", Content: "内容", Pinned: &pinned}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateNote(NoteInput{Title: "普通笔记", Content: "SQLite 明文存储", Notebook: "工作项目", Tags: []string{"架构"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateNote(NoteInput{Title: "AI 写的", Content: "由 agent 写入", Source: "mcp", Author: "claude"}); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		f     ListFilter
		count int
	}{
		{"all", ListFilter{Scope: "all"}, 5},       // 3 created + 2 seeded welcome notes
		{"pinned", ListFilter{Scope: "pinned"}, 2}, // mine + the seeded welcome note
		{"ai", ListFilter{Scope: "ai"}, 1},
		{"source", ListFilter{Scope: "source", Source: "mcp"}, 1},
		{"tag", ListFilter{Scope: "tag", Tag: "架构"}, 1},
		{"search", ListFilter{Scope: "all", Query: "SQLite"}, 2},
		{"notebook", ListFilter{Scope: "notebook", NotebookID: "missing"}, 0},
	}
	for _, c := range cases {
		notes, total, err := st.ListNotes(c.f)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if total != c.count || len(notes) != c.count {
			t.Errorf("%s: total=%d len=%d, want %d", c.name, total, len(notes), c.count)
		}
	}

	// Search results should be ranked with title matches first.
	notes, _, err := st.ListNotes(ListFilter{Scope: "all", Query: "普通"})
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) == 0 || notes[0].Title != "普通笔记" {
		t.Errorf("search should surface the title match first, got %+v", notes)
	}
}

// Regression: tag filtering used to only run when Scope was literally "tag",
// so callers passing Tag with the default "all" scope got the whole library.
func TestListNotesTagFilterIsIndependentOfScope(t *testing.T) {
	st := newTestStore(t)

	nb, err := st.GetNotebookByName("工作项目")
	if err != nil {
		t.Fatal(err)
	}
	a, err := st.CreateNote(NoteInput{Title: "带标签甲", Content: "alpha", Notebook: "工作项目", Tags: []string{"自检"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateNote(NoteInput{Title: "带标签乙", Content: "beta", Tags: []string{"自检"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateNote(NoteInput{Title: "无标签", Content: "gamma"}); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		f    ListFilter
		want int
	}{
		{"no scope", ListFilter{Tag: "自检"}, 2},
		{"all scope", ListFilter{Scope: "all", Tag: "自检"}, 2},
		{"legacy tag scope", ListFilter{Scope: "tag", Tag: "自检"}, 2},
		{"notebook scope combined", ListFilter{Scope: "notebook", NotebookID: nb.ID, Tag: "自检"}, 1},
		{"case insensitive", ListFilter{Scope: "all", Tag: "mcp"}, 1}, // seeded "MCP" tag
		{"leading hash", ListFilter{Scope: "all", Tag: "#自检"}, 2},
		{"unknown tag", ListFilter{Scope: "all", Tag: "__no_such_tag__"}, 0},
		{"no filter", ListFilter{Scope: "all"}, 5}, // 3 created + 2 seeded
	}
	for _, c := range cases {
		notes, total, err := st.ListNotes(c.f)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if total != c.want || len(notes) != c.want {
			t.Errorf("%s: total=%d len=%d, want %d", c.name, total, len(notes), c.want)
		}
	}

	// The tag predicate must not override the trash scope.
	if err := st.SoftDelete(a.ID); err != nil {
		t.Fatal(err)
	}
	trashed, total, err := st.ListNotes(ListFilter{Scope: "trash", Tag: "自检"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(trashed) != 1 || trashed[0].ID != a.ID {
		t.Errorf("trash + tag = %d notes (%v), want just the deleted note", total, trashed)
	}
}

func TestTrashAndRestore(t *testing.T) {
	st := newTestStore(t)

	n, err := st.CreateNote(NoteInput{Title: "待删除", Content: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDelete(n.ID); err != nil {
		t.Fatal(err)
	}
	// Deleted notes stay readable (the UI shows them read-only in the trash)…
	got, err := st.GetNote(n.ID)
	if err != nil {
		t.Fatalf("trashed note should still be readable: %v", err)
	}
	if got.DeletedAt == nil {
		t.Error("deletedAt should be set after soft delete")
	}
	// …but they disappear from the normal list.
	live, total, err := st.ListNotes(ListFilter{Scope: "all"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range live {
		if item.ID == n.ID {
			t.Error("soft-deleted note must not appear in the all scope")
		}
	}
	if total != 2 { // only the two seeded welcome notes remain
		t.Errorf("all scope total = %d, want 2", total)
	}
	trashed, trashTotal, err := st.ListNotes(ListFilter{Scope: "trash"})
	if err != nil {
		t.Fatal(err)
	}
	if trashTotal != 1 || len(trashed) != 1 {
		t.Fatalf("trash should hold 1 note, got %d", trashTotal)
	}
	if err := st.Restore(n.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := st.GetNote(n.ID)
	if err != nil {
		t.Errorf("restored note should be readable: %v", err)
	}
	if restored.DeletedAt != nil {
		t.Error("deletedAt should be cleared after restore")
	}
}

// Regression: MoveNote used to resolve (and create) the notebook before it
// checked the note id, so moving a non-existent note left a stray notebook
// behind and then failed later with an opaque "not found" from GetNote.
func TestMoveNoteRejectsUnknownIDWithoutCreatingNotebook(t *testing.T) {
	st := newTestStore(t)

	before, err := st.ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	err = st.MoveNote("note_does_not_exist", "不该被创建的笔记本")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown id should return ErrNotFound, got %v", err)
	}
	after, err := st.ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Errorf("a failed move must not create a notebook: %d -> %d", len(before), len(after))
	}
	for _, nb := range after {
		if nb.Name == "不该被创建的笔记本" {
			t.Error("stray notebook was created by a failed move")
		}
	}

	// The happy path still creates the target notebook and moves the note.
	n, err := st.CreateNote(NoteInput{Title: "可移动", Content: "正文"})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.MoveNote(n.ID, "目标笔记本"); err != nil {
		t.Fatalf("move existing note: %v", err)
	}
	got, err := st.GetNote(n.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.NotebookName != "目标笔记本" {
		t.Errorf("notebook = %q, want 目标笔记本", got.NotebookName)
	}
	nbs, err := st.ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if len(nbs) != len(before)+1 {
		t.Errorf("a successful move should create exactly one notebook, got %d", len(nbs)-len(before))
	}
}

// The sidebar queries must stay linear. A correlated scalar subquery makes
// SQLite rescan all live notes once per notebook/tag, which hangs the UI on a
// large library; assert the plan never regresses to that shape.
func TestListMetaQueriesAvoidCorrelatedSubquery(t *testing.T) {
	st := newTestStore(t)
	for _, tc := range []struct{ name, query string }{
		{"ListNotebooks", listNotebooksSQL},
		{"ListTags", listTagsSQL},
	} {
		rows, err := st.db.Query("EXPLAIN QUERY PLAN " + tc.query)
		if err != nil {
			t.Fatalf("%s: explain: %v", tc.name, err)
		}
		for rows.Next() {
			var id, parent, aux int
			var detail string
			if err := rows.Scan(&id, &parent, &aux, &detail); err != nil {
				t.Fatalf("%s: scan plan: %v", tc.name, err)
			}
			if strings.Contains(strings.ToUpper(detail), "CORRELATED SCALAR SUBQUERY") {
				t.Errorf("%s plan regressed to a correlated subquery: %s", tc.name, detail)
			}
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("%s: plan rows: %v", tc.name, err)
		}
		_ = rows.Close()
	}
}

// The grouped-join rewrite must produce exactly the same counts as the old
// correlated subquery, including empty notebooks, orphan tags and trash.
func TestListMetaCountsAfterGroupedRewrite(t *testing.T) {
	st := newTestStore(t)
	if _, _, err := st.CreateNotebook("计数验证", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.CreateNotebook("空分类", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateTag("空标签", ""); err != nil {
		t.Fatal(err)
	}
	n1, err := st.CreateNote(NoteInput{Title: "甲一", Content: "x", Notebook: "计数验证", Tags: []string{"标签甲"}})
	if err != nil {
		t.Fatal(err)
	}
	n2, err := st.CreateNote(NoteInput{Title: "甲二", Content: "y", Notebook: "计数验证", Tags: []string{"标签甲", "标签乙"}})
	if err != nil {
		t.Fatal(err)
	}
	n3, err := st.CreateNote(NoteInput{Title: "甲三", Content: "z", Notebook: "计数验证", Tags: []string{"标签甲"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDelete(n3.ID); err != nil {
		t.Fatal(err)
	}
	_ = n1
	_ = n2

	nbs, err := st.ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]int{}
	for _, nb := range nbs {
		byName[nb.Name] = nb.Count
	}
	if byName["计数验证"] != 2 || byName["空分类"] != 0 {
		t.Errorf("notebook counts = %v, want 计数验证=2 空分类=0", byName)
	}

	tags, err := st.ListTags()
	if err != nil {
		t.Fatal(err)
	}
	tagCount := map[string]int{}
	for _, tag := range tags {
		tagCount[tag.Name] = tag.Count
	}
	if tagCount["标签甲"] != 2 || tagCount["标签乙"] != 1 || tagCount["空标签"] != 0 {
		t.Errorf("tag counts = %v, want 标签甲=2 标签乙=1 空标签=0", tagCount)
	}
}

func TestRevisionsAreRecorded(t *testing.T) {
	st := newTestStore(t)

	n, err := st.CreateNote(NoteInput{Title: "版本", Content: "第一版"})
	if err != nil {
		t.Fatal(err)
	}
	content := "第二版"
	if _, err := st.UpdateNote(n.ID, NotePatch{Content: &content}); err != nil {
		t.Fatal(err)
	}

	revs, err := st.Revisions(n.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(revs) == 0 {
		t.Fatal("expected at least one revision")
	}
	_, body, err := st.GetRevision(revs[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "第一版") && !strings.Contains(body, "第二版") {
		t.Errorf("revision body looks wrong: %q", body)
	}
}

func TestTokens(t *testing.T) {
	st := newTestStore(t)

	tok, plaintext, err := st.CreateToken("测试令牌")
	if err != nil {
		t.Fatal(err)
	}
	if plaintext == "" {
		t.Fatal("plaintext token should be returned once")
	}
	if !st.VerifyToken(plaintext) {
		t.Error("freshly created token should verify")
	}
	if st.VerifyToken("lnm_not_a_real_token") {
		t.Error("bogus token must not verify")
	}
	if err := st.DeleteToken(tok.ID); err != nil {
		t.Fatal(err)
	}
	if st.VerifyToken(plaintext) {
		t.Error("revoked token must not verify")
	}
}

func TestStats(t *testing.T) {
	st := newTestStore(t)

	if _, err := st.CreateNote(NoteInput{Title: "统计", Content: "一二三四", Notebook: "工作项目", Tags: []string{"统计"}}); err != nil {
		t.Fatal(err)
	}
	stats, err := st.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	if stats.Notes < 3 {
		t.Errorf("notes = %d, want at least 3", stats.Notes)
	}
	if stats.Words == 0 {
		t.Error("words should be counted")
	}
	var found bool
	for _, item := range stats.ByNotebook {
		if item.Label == "工作项目" && item.Count >= 1 {
			found = true
		}
	}
	if !found {
		t.Errorf("byNotebook should include 工作项目: %+v", stats.ByNotebook)
	}
}

func TestNotebookAndTagPinRename(t *testing.T) {
	st := newTestStore(t)

	nb, created, err := st.CreateNotebook("设计稿", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("first CreateNotebook should report created=true")
	}
	existing, createdAgain, err := st.CreateNotebook("设计稿", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if createdAgain || existing.ID != nb.ID {
		t.Errorf("name clash should return the existing notebook without creating: %+v", existing)
	}
	tag, err := st.CreateTag("灵感", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateTag("读书", ""); err != nil {
		t.Fatal(err)
	}

	yes := true
	if _, err := st.UpdateNotebook(nb.ID, nil, nil, nil, nil, &yes); err != nil {
		t.Fatalf("pin notebook: %v", err)
	}
	if _, err := st.UpdateTag(tag.ID, nil, nil, &yes); err != nil {
		t.Fatalf("pin tag: %v", err)
	}

	nbs, err := st.ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	if !nbs[0].Pinned || nbs[0].ID != nb.ID {
		t.Errorf("pinned notebook should be first, got %+v", nbs[0])
	}
	tags, err := st.ListTags()
	if err != nil {
		t.Fatal(err)
	}
	if !tags[0].Pinned || tags[0].ID != tag.ID {
		t.Errorf("pinned tag should be first, got %+v", tags[0])
	}

	newName := "交互稿"
	renamed, err := st.UpdateNotebook(nb.ID, &newName, nil, nil, nil, nil)
	if err != nil || renamed.Name != newName {
		t.Fatalf("rename notebook: %v %+v", err, renamed)
	}
	tagName := "# 想法"
	rt, err := st.UpdateTag(tag.ID, &tagName, nil, nil)
	if err != nil || rt.Name != "想法" {
		t.Fatalf("rename tag: %v %+v", err, rt)
	}
	if !rt.Pinned {
		t.Error("renaming a tag must keep its pinned state")
	}

	dup := "读书"
	if _, err := st.UpdateTag(tag.ID, &dup, nil, nil); err == nil {
		t.Error("duplicate tag name should be rejected")
	}
	no := false
	if _, err := st.UpdateTag(tag.ID, nil, nil, &no); err != nil {
		t.Fatalf("unpin tag: %v", err)
	}
	unpinned, err := st.ListTags()
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range unpinned {
		if item.ID == tag.ID && item.Pinned {
			t.Error("tag should no longer be pinned")
		}
	}
}

// TestMigrateV1AddsPinnedColumns replays an upgrade from the first release:
// notebooks/tags existed without a `pinned` column and user_version was 1.
// Opening the same file must add the columns, keep the rows, and bump the
// version — and a second migration must not try to add the columns twice.
func TestMigrateV1AddsPinnedColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")

	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	for _, stmt := range []string{
		`CREATE TABLE notebooks (
			id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
			icon TEXT NOT NULL DEFAULT 'book', color TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE TABLE tags (
			id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
			color TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
		`INSERT INTO notebooks (id, name, created_at, updated_at)
		 VALUES ('nb-v1', '旧笔记本', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
		`INSERT INTO tags (id, name, created_at)
		 VALUES ('tag-v1', '旧标签', '2025-01-01T00:00:00Z')`,
		`PRAGMA user_version = 1`,
	} {
		if _, err := legacy.Exec(stmt); err != nil {
			t.Fatalf("prepare legacy schema: %v\nSQL: %s", err, stmt)
		}
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	st, err := Open(path)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	var version int
	if err := st.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatalf("read schema version: %v", err)
	}
	if version != schemaVersion {
		t.Errorf("schema version = %d, want %d", version, schemaVersion)
	}

	// The migrated rows survive and default to unpinned.
	for _, tc := range []struct{ table, id, name string }{
		{"notebooks", "nb-v1", "旧笔记本"},
		{"tags", "tag-v1", "旧标签"},
	} {
		var name string
		var pinned int
		if err := st.db.QueryRow(`SELECT name, pinned FROM `+tc.table+` WHERE id = ?`, tc.id).
			Scan(&name, &pinned); err != nil {
			t.Fatalf("%s: legacy row or pinned column missing: %v", tc.table, err)
		}
		if name != tc.name || pinned != 0 {
			t.Errorf("%s: got (%q, %d), want (%q, 0)", tc.table, name, pinned, tc.name)
		}
	}

	// New write paths must work against the migrated schema.
	yes := true
	if _, err := st.UpdateNotebook("nb-v1", nil, nil, nil, nil, &yes); err != nil {
		t.Fatalf("pin migrated notebook: %v", err)
	}
	if _, err := st.UpdateTag("tag-v1", nil, nil, &yes); err != nil {
		t.Fatalf("pin migrated tag: %v", err)
	}
	nbs, err := st.ListNotebooks()
	if err != nil || len(nbs) != 1 || !nbs[0].Pinned {
		t.Errorf("migrated notebook should be pinned and listed: %+v, err=%v", nbs, err)
	}
	tags, err := st.ListTags()
	if err != nil || len(tags) != 1 || !tags[0].Pinned {
		t.Errorf("migrated tag should be pinned and listed: %+v, err=%v", tags, err)
	}

	// Running the migration again must be a no-op, not a duplicate-column error.
	if err := st.migrate(); err != nil {
		t.Fatalf("second migration should be idempotent: %v", err)
	}
}
