package mcp

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"locknote-mcp/internal/store"
)

func newTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "mcp-test.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return NewServer(st, "test", "http://127.0.0.1:7420"), st
}

// call sends one JSON-RPC request and returns the response.
func call(t *testing.T, s *Server, sess *SessionInfo, method string, params any) *Response {
	t.Helper()
	req := &Request{JSONRPC: "2.0", ID: json.RawMessage(`1`), Method: method}
	if params != nil {
		raw, err := json.Marshal(params)
		if err != nil {
			t.Fatalf("marshal params: %v", err)
		}
		req.Params = raw
	}
	return s.Handle(context.Background(), req, sess)
}

// callToolResult runs a tool and returns the full result, including its
// structuredContent, so tests can check the machine-readable fields too.
func callToolResult(t *testing.T, s *Server, sess *SessionInfo, name string, args map[string]any) *ToolResult {
	t.Helper()
	resp := call(t, s, sess, "tools/call", map[string]any{"name": name, "arguments": args})
	if resp == nil {
		t.Fatalf("%s: nil response", name)
	}
	if resp.Error != nil {
		t.Fatalf("%s: rpc error %v", name, resp.Error)
	}
	switch v := resp.Result.(type) {
	case *ToolResult:
		return v
	case ToolResult:
		return &v
	default:
		t.Fatalf("%s: unexpected result type %T", name, resp.Result)
		return nil
	}
}

func toolText(res *ToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		b.WriteString(c.Text)
	}
	return b.String()
}

// callTool runs a tool and returns the concatenated text content.
func callTool(t *testing.T, s *Server, sess *SessionInfo, name string, args map[string]any) string {
	t.Helper()
	return toolText(callToolResult(t, s, sess, name, args))
}

func TestInitializeNegotiatesVersion(t *testing.T) {
	s, _ := newTestServer(t)
	sess := &SessionInfo{Transport: "http"}

	resp := call(t, s, sess, "initialize", map[string]any{
		"protocolVersion": "2025-06-18",
		"clientInfo":      map[string]any{"name": "claude-code", "version": "1.0"},
	})
	if resp.Error != nil {
		t.Fatalf("initialize error: %v", resp.Error)
	}
	result := resp.Result.(map[string]any)
	if result["protocolVersion"] != "2025-06-18" {
		t.Errorf("protocolVersion = %v", result["protocolVersion"])
	}
	if sess.ClientName != "claude-code" {
		t.Errorf("client name = %q", sess.ClientName)
	}
	if _, ok := result["instructions"]; !ok {
		t.Error("initialize should return instructions for the agent")
	}
	caps, _ := result["capabilities"].(map[string]any)
	for _, key := range []string{"tools", "resources", "prompts"} {
		if _, ok := caps[key]; !ok {
			t.Errorf("capabilities missing %q", key)
		}
	}

	// An unknown revision should fall back to the latest one we speak.
	old := &SessionInfo{}
	resp = call(t, s, old, "initialize", map[string]any{"protocolVersion": "1999-01-01"})
	if got := resp.Result.(map[string]any)["protocolVersion"]; got != LatestVersion {
		t.Errorf("fallback version = %v, want %s", got, LatestVersion)
	}
}

func TestToolsListIsWellFormed(t *testing.T) {
	s, _ := newTestServer(t)
	resp := call(t, s, &SessionInfo{}, "tools/list", nil)
	if resp.Error != nil {
		t.Fatalf("tools/list: %v", resp.Error)
	}
	tools := resp.Result.(map[string]any)["tools"].([]Tool)
	if len(tools) < 10 {
		t.Fatalf("expected a rich tool set, got %d", len(tools))
	}

	want := map[string]bool{"save_note": false, "search_notes": false, "get_note": false, "append_to_note": false}
	for _, tool := range tools {
		if tool.Name == "" || tool.Description == "" {
			t.Errorf("tool %q is missing a name or description", tool.Name)
		}
		if tool.InputSchema == nil {
			t.Errorf("tool %q is missing an input schema", tool.Name)
		}
		if _, ok := want[tool.Name]; ok {
			want[tool.Name] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("tool %q not registered", name)
		}
	}
}

func TestSaveNoteToolWritesToStore(t *testing.T) {
	s, st := newTestServer(t)
	sess := &SessionInfo{Transport: "http", ClientName: "claude-code"}

	out := callTool(t, s, sess, "save_note", map[string]any{
		"title":       "部署手册",
		"notebook":    "工作项目",
		"tags":        []string{"部署", "运维"},
		"content":     "## 步骤\n\n1. 构建\n2. 上线\n",
		"external_id": "docs/deploy",
	})
	if !strings.Contains(out, "部署手册") {
		t.Errorf("tool output should mention the title, got %q", out)
	}

	notes, total, err := st.ListNotes(store.ListFilter{Scope: "source", Source: "mcp"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(notes) != 1 {
		t.Fatalf("expected 1 MCP note, got %d", total)
	}
	got := notes[0]
	if got.Title != "部署手册" || got.NotebookName != "工作项目" {
		t.Errorf("note fields wrong: %+v", got)
	}
	if got.ExternalID != "docs/deploy" || got.Author != "claude-code" {
		t.Errorf("provenance wrong: externalId=%q author=%q", got.ExternalID, got.Author)
	}
	if len(got.Tags) != 2 {
		t.Errorf("tags = %v", got.Tags)
	}
}

func TestSaveNoteReplaceByExternalID(t *testing.T) {
	s, st := newTestServer(t)
	sess := &SessionInfo{}

	callTool(t, s, sess, "save_note", map[string]any{
		"title": "架构", "content": "v1", "external_id": "arch", "if_exists": "replace",
	})
	callTool(t, s, sess, "save_note", map[string]any{
		"content": "v2", "external_id": "arch", "if_exists": "replace",
	})

	notes, total, err := st.ListNotes(store.ListFilter{Scope: "source", Source: "mcp"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Fatalf("external_id should dedupe notes, got %d", total)
	}
	full, err := st.GetNote(notes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if full.Content != "v2" {
		t.Errorf("content = %q, want v2", full.Content)
	}
}

// Regression: if_exists=skip used to be reported as "已更新" even though the
// store deliberately left the note untouched.
func TestSaveNoteSkipReportsAccurately(t *testing.T) {
	s, st := newTestServer(t)
	sess := &SessionInfo{}

	callTool(t, s, sess, "save_note", map[string]any{"title": "同名笔记", "content": "原始正文"})
	before, err := st.FindNoteByTitle("同名笔记", "")
	if err != nil {
		t.Fatal(err)
	}

	res := callToolResult(t, s, sess, "save_note", map[string]any{
		"title": "同名笔记", "content": "完全不同的新正文", "if_exists": "skip",
	})
	text := toolText(res)
	if !strings.Contains(text, "已跳过") {
		t.Errorf("skip result must say 已跳过, got %q", text)
	}
	if strings.Contains(text, "已更新") {
		t.Errorf("skip result must not claim 已更新, got %q", text)
	}
	data, ok := res.StructuredContent.(map[string]any)
	if !ok {
		t.Fatalf("structuredContent has unexpected type %T", res.StructuredContent)
	}
	if data["skipped"] != true || data["created"] != false || data["action"] != "skipped" {
		t.Errorf("structured result = %v, want skipped=true created=false action=skipped", data)
	}

	after, err := st.GetNote(before.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Content != "原始正文" {
		t.Errorf("skip must not change content, got %q", after.Content)
	}
	if after.Version != before.Version {
		t.Errorf("skip must not bump version: %d -> %d", before.Version, after.Version)
	}
	_, total, err := st.ListNotes(store.ListFilter{Scope: "source", Source: "mcp"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("skip must not create a duplicate, got %d MCP notes", total)
	}
	activity, err := st.Activity(20)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range activity {
		if a.Kind == "note.updated" {
			t.Errorf("skip must not record a note.updated activity: %+v", a)
		}
	}
}

func TestSaveNotesSkipIsLabelledAndCounted(t *testing.T) {
	s, _ := newTestServer(t)
	sess := &SessionInfo{}

	callTool(t, s, sess, "save_note", map[string]any{"title": "已存在", "content": "原始"})
	res := callToolResult(t, s, sess, "save_notes", map[string]any{
		"if_exists": "skip",
		"notes": []any{
			map[string]any{"title": "已存在", "content": "新正文"},
			map[string]any{"title": "新笔记", "content": "全新"},
		},
	})
	text := toolText(res)
	if !strings.Contains(text, "跳过（已存在，未修改）《已存在》") {
		t.Errorf("batch skip should be labelled as skipped, got %q", text)
	}
	if !strings.Contains(text, "新建《新笔记》") {
		t.Errorf("batch create should still be labelled 新建, got %q", text)
	}
	data := res.StructuredContent.(map[string]any)
	if data["skipped"] != 1 || data["created"] != 1 || data["updated"] != 0 {
		t.Errorf("batch counters = %v, want created=1 updated=0 skipped=1", data)
	}
}

// Regression: creating a notebook that already exists is a no-op, but the
// handler still wrote a "notebook.created" activity and claimed a creation.
func TestCreateNotebookIdempotentDoesNotRecordActivity(t *testing.T) {
	s, st := newTestServer(t)
	sess := &SessionInfo{}

	first := callToolResult(t, s, sess, "create_notebook", map[string]any{"name": "压测专用"})
	if first.StructuredContent.(map[string]any)["created"] != true {
		t.Errorf("new notebook should report created=true, got %v", first.StructuredContent)
	}
	if !strings.Contains(toolText(first), "已新建笔记本") {
		t.Errorf("new notebook text = %q", toolText(first))
	}

	activityBefore, err := st.Activity(50)
	if err != nil {
		t.Fatal(err)
	}
	second := callToolResult(t, s, sess, "create_notebook", map[string]any{
		"name": "压测专用", "description": "这段说明不应被写入",
	})
	text := toolText(second)
	if !strings.Contains(text, "已存在") || !strings.Contains(text, "未作任何修改") {
		t.Errorf("idempotent call should say the notebook already exists, got %q", text)
	}
	data := second.StructuredContent.(map[string]any)
	if data["created"] != false || data["action"] != "unchanged" {
		t.Errorf("idempotent structured result = %v", data)
	}
	activityAfter, err := st.Activity(50)
	if err != nil {
		t.Fatal(err)
	}
	if len(activityAfter) != len(activityBefore) {
		t.Errorf("idempotent create must not record activity: %d -> %d", len(activityBefore), len(activityAfter))
	}
	nb, err := st.GetNotebookByName("压测专用")
	if err != nil {
		t.Fatal(err)
	}
	if nb.Description != "" {
		t.Errorf("idempotent create must not rewrite description, got %q", nb.Description)
	}
	if first.StructuredContent.(map[string]any)["id"] != nb.ID {
		t.Error("idempotent create should return the same notebook id")
	}
}

// Regression: the tag argument was accepted but ignored by list_notes because
// the store only looked at it when Scope was literally "tag".
func TestListNotesToolFiltersByTag(t *testing.T) {
	s, _ := newTestServer(t)
	sess := &SessionInfo{}

	callTool(t, s, sess, "save_note", map[string]any{"title": "标签甲", "content": "alpha", "tags": []string{"自检标记"}})
	callTool(t, s, sess, "save_note", map[string]any{"title": "标签乙", "content": "beta", "tags": []string{"自检标记"}})
	callTool(t, s, sess, "save_note", map[string]any{"title": "无标签笔记", "content": "gamma"})

	list := callTool(t, s, sess, "list_notes", map[string]any{"tag": "自检标记"})
	if !strings.Contains(list, "共 2 篇") {
		t.Errorf("tag filter should return exactly 2 notes, got %q", list)
	}
	if !strings.Contains(list, "标签甲") || !strings.Contains(list, "标签乙") {
		t.Errorf("tagged notes missing from result: %q", list)
	}
	if strings.Contains(list, "无标签笔记") {
		t.Errorf("untagged note leaked into tag filter: %q", list)
	}

	empty := callTool(t, s, sess, "list_notes", map[string]any{"tag": "__no_such_tag__"})
	if !strings.Contains(empty, "没有找到符合条件的笔记") {
		t.Errorf("unknown tag should return an empty result, got %q", empty)
	}
}

func TestGetAndSearchTools(t *testing.T) {
	s, _ := newTestServer(t)
	sess := &SessionInfo{}

	saved := callTool(t, s, sess, "save_note", map[string]any{
		"title": "检索目标", "content": "独特关键词：蓝鲸计划", "notebook": "收集箱",
	})
	if !strings.Contains(saved, "id:") {
		t.Fatalf("save_note should return the note id, got %q", saved)
	}

	search := callTool(t, s, sess, "search_notes", map[string]any{"query": "蓝鲸计划"})
	if !strings.Contains(search, "检索目标") {
		t.Errorf("search should find the note, got %q", search)
	}

	list := callTool(t, s, sess, "list_notes", map[string]any{"scope": "all", "limit": 5})
	if !strings.Contains(list, "检索目标") {
		t.Errorf("list_notes should include the note, got %q", list)
	}

	overview := callTool(t, s, sess, "workspace_overview", map[string]any{})
	if !strings.Contains(overview, "收集箱") {
		t.Errorf("overview should mention notebooks, got %q", overview)
	}
}

func TestAppendAndMoveTools(t *testing.T) {
	s, st := newTestServer(t)
	sess := &SessionInfo{}

	callTool(t, s, sess, "save_note", map[string]any{"title": "日志", "content": "第一条"})
	note, err := st.FindNoteByTitle("日志", "")
	if err != nil {
		t.Fatal(err)
	}

	callTool(t, s, sess, "append_to_note", map[string]any{"id": note.ID, "content": "第二条"})
	updated, err := st.GetNote(note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(updated.Content, "第一条") || !strings.Contains(updated.Content, "第二条") {
		t.Errorf("append should keep both parts, got %q", updated.Content)
	}

	callTool(t, s, sess, "move_note", map[string]any{"id": note.ID, "notebook": "学习与阅读"})
	moved, err := st.GetNote(note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if moved.NotebookName != "学习与阅读" {
		t.Errorf("notebook = %q, want 学习与阅读", moved.NotebookName)
	}
}

// Regression: an unknown id used to create the target notebook as a side
// effect and then fail with "移动后读取失败：not found".
func TestMoveNoteUnknownIDReportsCleanly(t *testing.T) {
	s, st := newTestServer(t)
	sess := &SessionInfo{}

	text := callTool(t, s, sess, "move_note", map[string]any{
		"id": "note_no_such_id", "notebook": "幽灵笔记本",
	})
	if !strings.Contains(text, "找不到 id 为 note_no_such_id 的笔记") {
		t.Errorf("unknown id should get the friendly message, got %q", text)
	}
	if strings.Contains(text, "移动后读取失败") {
		t.Errorf("should not fall through to the confusing GetNote error, got %q", text)
	}
	nbs, err := st.ListNotebooks()
	if err != nil {
		t.Fatal(err)
	}
	for _, nb := range nbs {
		if nb.Name == "幽灵笔记本" {
			t.Error("failed move created a stray notebook")
		}
	}
}

func TestUnknownToolAndMethod(t *testing.T) {
	s, _ := newTestServer(t)

	resp := call(t, s, &SessionInfo{}, "tools/call", map[string]any{"name": "no_such_tool", "arguments": map[string]any{}})
	if resp.Error == nil || resp.Error.Code != CodeInvalidParams {
		t.Errorf("unknown tool should be an invalid params error, got %+v", resp.Error)
	}

	resp = call(t, s, &SessionInfo{}, "totally/unknown", nil)
	if resp.Error == nil || resp.Error.Code != CodeMethodNotFound {
		t.Errorf("unknown method should be -32601, got %+v", resp.Error)
	}
}

func TestResourcesAndPrompts(t *testing.T) {
	s, _ := newTestServer(t)
	sess := &SessionInfo{}

	list := call(t, s, sess, "resources/list", nil)
	if list.Error != nil {
		t.Fatalf("resources/list: %v", list.Error)
	}
	resources := list.Result.(map[string]any)["resources"].([]Resource)
	if len(resources) == 0 {
		t.Fatal("expected at least one resource")
	}

	read := call(t, s, sess, "resources/read", map[string]any{"uri": "locknote://recent"})
	if read.Error != nil {
		t.Fatalf("resources/read: %v", read.Error)
	}
	contents := read.Result.(map[string]any)["contents"].([]ResourceContent)
	if len(contents) == 0 || contents[0].Text == "" {
		t.Error("recent resource should return text")
	}

	prompts := call(t, s, sess, "prompts/list", nil)
	if prompts.Error != nil {
		t.Fatalf("prompts/list: %v", prompts.Error)
	}
	if len(prompts.Result.(map[string]any)["prompts"].([]Prompt)) == 0 {
		t.Fatal("expected at least one prompt")
	}

	got := call(t, s, sess, "prompts/get", map[string]any{"name": "save_project_docs", "arguments": map[string]any{"project": "locknote-mcp"}})
	if got.Error != nil {
		t.Fatalf("prompts/get: %v", got.Error)
	}
	msgs := got.Result.(map[string]any)["messages"].([]PromptMessage)
	if len(msgs) == 0 || !strings.Contains(msgs[0].Content.Text, "locknote-mcp") {
		t.Error("prompt should be rendered with the project argument")
	}
}

func TestNotificationReturnsNoResponse(t *testing.T) {
	s, _ := newTestServer(t)
	resp := s.Handle(context.Background(), &Request{JSONRPC: "2.0", Method: "notifications/initialized"}, &SessionInfo{})
	if resp != nil {
		t.Errorf("notifications must not produce a response, got %+v", resp)
	}
}
