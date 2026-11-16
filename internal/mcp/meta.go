package mcp

// enMeta holds the English copy shown in the web UI when the user switches
// the interface language. MCP clients keep receiving the Chinese protocol
// descriptions; only the human-facing settings/overview panels use these.
type enMeta struct{ Title, Description string }

var enTools = map[string]enMeta{
	"save_note":          {"Save Note", "Save a Markdown document to LockNote.app — plans, summaries, meeting notes, code docs or research notes. Matching titles append by default; pass external_id to update the same document instead of creating duplicates. Returns the note id, title and notebook."},
	"save_notes":         {"Save Multiple Notes", "Save several notes at once — ideal for importing a project's documents, a set of meeting notes or a whole directory. All notes can share one default notebook."},
	"get_note":           {"Read Note", "Read the full Markdown body and metadata of a note by id (or by title, optionally scoped to a notebook). Call before summarising, continuing or quoting an existing note."},
	"update_note":        {"Update Note", "Change a note's title, body, notebook, tags or pinned state. Only pass the fields you want to change; updating the body records a revision. Use append_to_note to add content at the end."},
	"append_to_note":     {"Append to Note", "Append a Markdown fragment to the end of an existing note (separated by a blank line). Useful for progress updates and running logs."},
	"move_note":          {"Move Note", "Move a note to another notebook (created on demand). Pass an empty string to move it to Uncategorized."},
	"delete_note":        {"Delete Note", "Move a note to Trash (recoverable by default). Set hard=true to delete permanently — only when the user explicitly asks."},
	"restore_note":       {"Restore Note", "Restore a note from Trash."},
	"list_notes":         {"List Notes", "List notes by scope, notebook, tag or keyword (titles, excerpts and timestamps, without bodies). Use it to browse the structure of the library."},
	"search_notes":       {"Search Notes", "Full-text search across titles, bodies and tags. Prefer it when looking for something written earlier."},
	"list_notebooks":     {"List Notebooks", "List every notebook with its note count. Check here before saving so existing notebooks can be reused."},
	"create_notebook":    {"Create Notebook", "Create a new notebook. If the name already exists, the existing one is returned."},
	"list_tags":          {"List Tags", "List every tag and how often it is used."},
	"workspace_overview": {"Workspace Overview", "Get an overview of the library: total notes, word count, notebook distribution, recent edits and recent AI writes. Call it at the start of a task to see what has already been recorded."},
}

var enPrompts = map[string]enMeta{
	"save_project_docs":  {"Save Project Docs to LockNote.app", "Guide the model through the current project's documents and write them into a notebook in a structured way."},
	"summarize_notebook": {"Summarize a Notebook", "Read the notes in a notebook and produce a structured summary."},
	"daily_digest":       {"Daily Digest", "Review recently edited notes and produce a short progress summary."},
}

var enResources = map[string]enMeta{
	"locknote://notes/{id}":      {"Full Note", "Read the full Markdown body of a note by id, e.g. locknote://notes/note_abc123."},
	"locknote://notebook/{name}": {"Notebook Index", "List all notes in a notebook."},
	"locknote://tag/{name}":      {"Tag Index", "List all notes carrying a tag."},
}

// ToolsMeta returns tool metadata for the web UI (no handlers).
func (s *Server) ToolsMeta() []map[string]any {
	tools := s.tools()
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		required := []string{}
		if r, ok := t.InputSchema["required"].([]string); ok {
			required = r
		}
		en := enTools[t.Name]
		out = append(out, map[string]any{
			"name":          t.Name,
			"title":         t.Title,
			"description":   t.Description,
			"titleEn":       en.Title,
			"descriptionEn": en.Description,
			"required":      required,
			"readOnly":      t.Annotations != nil && t.Annotations["readOnlyHint"] == true,
		})
	}
	return out
}

// PromptsMeta returns prompt metadata for the web UI.
func (s *Server) PromptsMeta() []map[string]any {
	prompts := s.promptList()
	out := make([]map[string]any, 0, len(prompts))
	for _, p := range prompts {
		args := make([]map[string]any, 0, len(p.Arguments))
		for _, a := range p.Arguments {
			args = append(args, map[string]any{"name": a.Name, "description": a.Description, "required": a.Required})
		}
		en := enPrompts[p.Name]
		out = append(out, map[string]any{
			"name":          p.Name,
			"title":         p.Title,
			"description":   p.Description,
			"titleEn":       en.Title,
			"descriptionEn": en.Description,
			"arguments":     args,
		})
	}
	return out
}

// ResourcesMeta returns resource template metadata for the web UI.
func (s *Server) ResourcesMeta() []map[string]any {
	tpls := s.resourceTemplates()
	out := make([]map[string]any, 0, len(tpls))
	for _, t := range tpls {
		en := enResources[t.URITemplate]
		out = append(out, map[string]any{
			"uriTemplate":   t.URITemplate,
			"name":          t.Name,
			"title":         t.Title,
			"description":   t.Description,
			"titleEn":       en.Title,
			"descriptionEn": en.Description,
		})
	}
	return out
}
