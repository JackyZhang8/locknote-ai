package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"locknote-mcp/internal/store"
)

// SessionInfo carries per-connection state negotiated during initialize.
type SessionInfo struct {
	ID              string
	ProtocolVersion string
	ClientName      string
	ClientVersion   string
	Transport       string // "http" | "stdio"
	Initialized     bool
}

// Context is passed to every tool handler.
type Context struct {
	Ctx       context.Context
	Store     *store.Store
	Session   *SessionInfo
	Tool      string
	Transport string
	Client    string
}

// Server is the MCP server. It is safe for concurrent use: all state lives in
// the store.
type Server struct {
	Store   *store.Store
	Version string
	BaseURL string
	Logger  *log.Logger
	// OnChange is invoked after a note is created, updated or deleted so the
	// web UI can refresh live.
	OnChange func(kind string, note *store.Note)
}

// NewServer wires a server around a store.
func NewServer(st *store.Store, version, baseURL string) *Server {
	return &Server{
		Store:   st,
		Version: version,
		BaseURL: strings.TrimRight(baseURL, "/"),
		Logger:  log.New(os.Stderr, "[mcp] ", log.LstdFlags),
	}
}

func (s *Server) serverInfo() Implementation {
	return Implementation{Name: "locknote-mcp", Title: "Locknote", Version: s.Version}
}

const instructions = `Locknote 是一个本地 Markdown 笔记库，你现在可以直接读写它。

使用建议：
1. 保存文档、方案、总结、会议记录、代码说明时，优先调用 save_note，把内容写成结构清晰的 Markdown（用 # 标题、列表、表格、代码块）。
2. 用 notebook 参数归类（例如「工作项目」「学习与阅读」），不存在会自动创建；用 tags 做跨笔记本的主题标记。
3. 同一个文档反复更新时，传入稳定的 external_id（如仓库路径或文档 slug）并设置 if_exists="replace"，可以避免产生重复笔记。
4. 需要先了解已有内容时，用 workspace_overview 看全局，用 list_notes / search_notes 检索，用 get_note 读取全文。
5. 保存后请把返回的笔记标题和 id 告诉用户，方便在 Locknote 界面里继续编辑。

笔记内容是纯 Markdown 明文，用户会在网页界面中看到并可以继续修改。`

// Handle dispatches one JSON-RPC request. It returns nil for notifications.
func (s *Server) Handle(ctx context.Context, req *Request, sess *SessionInfo) *Response {
	if req.JSONRPC != "" && req.JSONRPC != "2.0" {
		return &Response{JSONRPC: "2.0", ID: idOrNull(req.ID), Error: NewError(CodeInvalidRequest, "unsupported jsonrpc version %q", req.JSONRPC)}
	}
	if sess == nil {
		sess = &SessionInfo{}
	}

	var result any
	var rpcErr *RPCError

	switch req.Method {
	case "initialize":
		result, rpcErr = s.initialize(req, sess)
	case "notifications/initialized", "notifications/cancelled", "notifications/roots/list_changed":
		sess.Initialized = true
		return nil
	case "ping":
		result = map[string]any{}
	case "tools/list":
		result = map[string]any{"tools": s.toolList()}
	case "tools/call":
		result, rpcErr = s.callTool(ctx, req, sess)
	case "resources/list":
		result, rpcErr = s.listResources(ctx)
	case "resources/templates/list":
		result = map[string]any{"resourceTemplates": s.resourceTemplates()}
	case "resources/read":
		result, rpcErr = s.readResource(ctx, req)
	case "prompts/list":
		result = map[string]any{"prompts": s.promptList()}
	case "prompts/get":
		result, rpcErr = s.getPrompt(req)
	case "completion/complete":
		result = map[string]any{"completion": map[string]any{"values": []string{}, "total": 0, "hasMore": false}}
	case "logging/setLevel":
		result = map[string]any{}
	default:
		rpcErr = NewError(CodeMethodNotFound, "method not found: %s", req.Method)
	}

	if req.IsNotification() {
		return nil
	}
	resp := &Response{JSONRPC: "2.0", ID: idOrNull(req.ID)}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	return resp
}

func (s *Server) initialize(req *Request, sess *SessionInfo) (any, *RPCError) {
	var params struct {
		ProtocolVersion string         `json:"protocolVersion"`
		ClientInfo      Implementation `json:"clientInfo"`
	}
	if len(req.Params) > 0 {
		_ = json.Unmarshal(req.Params, &params)
	}
	sess.ProtocolVersion = negotiateVersion(params.ProtocolVersion)
	sess.ClientName = params.ClientInfo.Name
	sess.ClientVersion = params.ClientInfo.Version

	if sess.ClientName != "" {
		s.Logger.Printf("client connected: %s %s (protocol %s)", sess.ClientName, sess.ClientVersion, sess.ProtocolVersion)
	}

	return map[string]any{
		"protocolVersion": sess.ProtocolVersion,
		"capabilities": map[string]any{
			"tools":     map[string]any{"listChanged": false},
			"resources": map[string]any{"subscribe": false, "listChanged": false},
			"prompts":   map[string]any{"listChanged": false},
			"logging":   map[string]any{},
		},
		"serverInfo":   s.serverInfo(),
		"instructions": instructions,
	}, nil
}

func negotiateVersion(client string) string {
	for _, v := range supportedVersions {
		if client == v {
			return v
		}
	}
	return LatestVersion
}

func idOrNull(id json.RawMessage) json.RawMessage {
	if len(id) == 0 {
		return json.RawMessage("null")
	}
	return id
}

func (s *Server) callTool(ctx context.Context, req *Request, sess *SessionInfo) (any, *RPCError) {
	var params struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, NewError(CodeInvalidParams, "invalid params: %v", err)
		}
	}
	if params.Name == "" {
		return nil, NewError(CodeInvalidParams, "tool name is required")
	}
	tool := s.toolByName(params.Name)
	if tool == nil {
		return nil, NewError(CodeInvalidParams, "unknown tool: %s", params.Name)
	}
	if params.Arguments == nil {
		params.Arguments = map[string]any{}
	}

	tc := &Context{
		Ctx:       ctx,
		Store:     s.Store,
		Session:   sess,
		Tool:      tool.Name,
		Transport: sess.Transport,
		Client:    sess.ClientName,
	}

	res := tool.handler(tc, params.Arguments)
	if res.Content == nil {
		res.Content = []Content{}
	}
	return res, nil
}

func (s *Server) toolByName(name string) *Tool {
	all := s.tools()
	for i := range all {
		if all[i].Name == name {
			return &all[i]
		}
	}
	return nil
}

func (s *Server) toolList() []Tool {
	out := s.tools()
	for i := range out {
		out[i].handler = nil
	}
	return out
}

// notifyChange tells the UI something changed.
func (s *Server) notifyChange(kind string, n *store.Note) {
	if s.OnChange != nil && n != nil {
		s.OnChange(kind, n)
	}
}

// record logs an MCP-driven change into the activity feed.
func (s *Server) record(tc *Context, kind, noteID, title, detail string) {
	actor := "mcp"
	if tc.Client != "" {
		actor = tc.Client
	}
	s.Store.RecordActivity(kind, tc.Tool, noteID, title, detail, actor)
}

// noteFacts describes tags and length, without repeating the notebook.
func noteFacts(n *store.Note) string {
	parts := []string{}
	if len(n.Tags) > 0 {
		parts = append(parts, "标签 "+strings.Join(n.Tags, ", "))
	}
	parts = append(parts, fmt.Sprintf("%d 字", n.WordCount))
	return strings.Join(parts, " · ")
}

func toolSummary(n *store.Note) string {
	parts := []string{}
	if n.NotebookName != "" {
		parts = append(parts, "笔记本 "+n.NotebookName)
	}
	if len(n.Tags) > 0 {
		parts = append(parts, "标签 "+strings.Join(n.Tags, ", "))
	}
	parts = append(parts, fmt.Sprintf("%d 字", n.WordCount))
	return strings.Join(parts, " · ")
}
