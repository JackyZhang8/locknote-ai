package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"locknote-mcp/internal/store"
)

// listResources exposes the stable entry points of the library.
func (s *Server) listResources(ctx context.Context) (any, *RPCError) {
	nbs, err := s.Store.ListNotebooks()
	if err != nil {
		return nil, NewError(CodeInternalError, "list notebooks: %v", err)
	}
	res := []Resource{
		{
			URI:         "locknote://recent",
			Name:        "recent-notes",
			Title:       "最近编辑的笔记",
			Description: "最近更新的 20 篇笔记索引（标题、id、摘要）。",
			MIMEType:    "text/markdown",
		},
		{
			URI:         "locknote://notebooks",
			Name:        "notebooks",
			Title:       "笔记本列表",
			Description: "所有笔记本及其笔记数量。",
			MIMEType:    "application/json",
		},
		{
			URI:         "locknote://tags",
			Name:        "tags",
			Title:       "标签列表",
			Description: "所有标签及其使用次数。",
			MIMEType:    "application/json",
		},
	}
	for _, nb := range nbs {
		res = append(res, Resource{
			URI:         "locknote://notebook/" + url.PathEscape(nb.Name),
			Name:        "notebook-" + nb.Name,
			Title:       "笔记本 · " + nb.Name,
			Description: fmt.Sprintf("「%s」中的笔记索引（%d 篇）。", nb.Name, nb.Count),
			MIMEType:    "text/markdown",
		})
	}
	return map[string]any{"resources": res}, nil
}

func (s *Server) resourceTemplates() []ResourceTemplate {
	return []ResourceTemplate{
		{
			URITemplate: "locknote://notes/{id}",
			Name:        "note",
			Title:       "单篇笔记全文",
			Description: "按笔记 id 读取 Markdown 全文，例如 locknote://notes/note_abc123。",
			MIMEType:    "text/markdown",
		},
		{
			URITemplate: "locknote://notebook/{name}",
			Name:        "notebook",
			Title:       "笔记本索引",
			Description: "列出某个笔记本中的全部笔记。",
			MIMEType:    "text/markdown",
		},
		{
			URITemplate: "locknote://tag/{name}",
			Name:        "tag",
			Title:       "标签索引",
			Description: "列出带有某个标签的全部笔记。",
			MIMEType:    "text/markdown",
		},
	}
}

// readResource resolves locknote:// URIs.
func (s *Server) readResource(ctx context.Context, req *Request) (any, *RPCError) {
	var params struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return nil, NewError(CodeInvalidParams, "invalid params: %v", err)
	}
	uri := strings.TrimSpace(params.URI)
	if !strings.HasPrefix(uri, "locknote://") {
		return nil, NewError(CodeInvalidParams, "unsupported uri: %s", uri)
	}
	path := strings.TrimPrefix(uri, "locknote://")
	path = strings.TrimPrefix(path, "/")

	parts := strings.SplitN(path, "/", 2)
	head := parts[0]
	rest := ""
	if len(parts) > 1 {
		rest = parts[1]
	}
	if decoded, err := url.PathUnescape(rest); err == nil {
		rest = decoded
	}

	contents := []ResourceContent{}
	switch head {
	case "recent":
		notes, _, err := s.Store.ListNotes(store.ListFilter{Scope: "all", Sort: "updated", Limit: 20})
		if err != nil {
			return nil, NewError(CodeInternalError, "%v", err)
		}
		contents = append(contents, ResourceContent{URI: uri, MIMEType: "text/markdown", Text: renderNoteIndex("最近编辑的笔记", notes)})
	case "notebooks":
		nbs, err := s.Store.ListNotebooks()
		if err != nil {
			return nil, NewError(CodeInternalError, "%v", err)
		}
		raw, _ := json.MarshalIndent(nbs, "", "  ")
		contents = append(contents, ResourceContent{URI: uri, MIMEType: "application/json", Text: string(raw)})
	case "tags":
		tags, err := s.Store.ListTags()
		if err != nil {
			return nil, NewError(CodeInternalError, "%v", err)
		}
		raw, _ := json.MarshalIndent(tags, "", "  ")
		contents = append(contents, ResourceContent{URI: uri, MIMEType: "application/json", Text: string(raw)})
	case "notes":
		if rest == "" {
			return nil, NewError(CodeInvalidParams, "note id is required: locknote://notes/{id}")
		}
		note, err := s.Store.GetNote(rest)
		if err != nil {
			return nil, NewError(CodeInvalidParams, "note not found: %s", rest)
		}
		contents = append(contents, ResourceContent{URI: uri, MIMEType: "text/markdown", Text: renderNoteDocument(note)})
	case "notebook":
		if rest == "" {
			return nil, NewError(CodeInvalidParams, "notebook name is required: locknote://notebook/{name}")
		}
		nb, err := s.Store.GetNotebookByName(rest)
		if err != nil {
			return nil, NewError(CodeInvalidParams, "notebook not found: %s", rest)
		}
		notes, _, err := s.Store.ListNotes(store.ListFilter{Scope: "notebook", NotebookID: nb.ID, Sort: "updated", Limit: 200})
		if err != nil {
			return nil, NewError(CodeInternalError, "%v", err)
		}
		contents = append(contents, ResourceContent{URI: uri, MIMEType: "text/markdown",
			Text: renderNoteIndex("笔记本 · "+nb.Name, notes)})
	case "tag":
		if rest == "" {
			return nil, NewError(CodeInvalidParams, "tag name is required: locknote://tag/{name}")
		}
		notes, _, err := s.Store.ListNotes(store.ListFilter{Scope: "tag", Tag: rest, Sort: "updated", Limit: 200})
		if err != nil {
			return nil, NewError(CodeInternalError, "%v", err)
		}
		contents = append(contents, ResourceContent{URI: uri, MIMEType: "text/markdown",
			Text: renderNoteIndex("标签 · #"+rest, notes)})
	default:
		return nil, NewError(CodeInvalidParams, "unsupported uri: %s", uri)
	}

	return map[string]any{"contents": contents}, nil
}

func renderNoteDocument(n *store.Note) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("id: " + n.ID + "\n")
	b.WriteString("title: " + n.Title + "\n")
	if n.NotebookName != "" {
		b.WriteString("notebook: " + n.NotebookName + "\n")
	}
	if len(n.Tags) > 0 {
		b.WriteString("tags: [" + strings.Join(n.Tags, ", ") + "]\n")
	}
	b.WriteString("source: " + n.Source + "\n")
	b.WriteString("created: " + n.CreatedAt.Format("2006-01-02T15:04:05Z07:00") + "\n")
	b.WriteString("updated: " + n.UpdatedAt.Format("2006-01-02T15:04:05Z07:00") + "\n")
	b.WriteString("---\n\n")
	b.WriteString(n.Content)
	if !strings.HasSuffix(n.Content, "\n") {
		b.WriteString("\n")
	}
	return b.String()
}

func renderNoteIndex(title string, notes []*store.Note) string {
	var b strings.Builder
	b.WriteString("# " + title + "\n\n")
	if len(notes) == 0 {
		b.WriteString("_这里还没有笔记。_\n")
		return b.String()
	}
	b.WriteString(fmt.Sprintf("共 %d 篇。\n\n", len(notes)))
	for _, n := range notes {
		b.WriteString(fmt.Sprintf("- **%s** — `%s`\n", n.Title, n.ID))
		if n.Excerpt != "" {
			b.WriteString("  " + n.Excerpt + "\n")
		}
	}
	return b.String()
}
