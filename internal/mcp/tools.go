package mcp

import (
	"fmt"
	"sort"
	"strings"

	"locknote-mcp/internal/store"
	"locknote-mcp/internal/textutil"
)

// tools returns every tool definition. The descriptions are written for an LLM
// reader: they explain *when* to use the tool, not just what it does.
func (s *Server) tools() []Tool {
	return []Tool{
		{
			Name:  "save_note",
			Title: "保存笔记",
			Description: "把一份 Markdown 文档保存到 Locknote。适合保存方案、总结、会议记录、代码说明、研究笔记等。" +
				"若同名笔记已存在，默认追加内容；传入 external_id 可让同一份文档多次保存时自动更新而不是重复创建。" +
				"返回笔记 id、标题与所在笔记本。",
			InputSchema: object(map[string]any{
				"title":       str("笔记标题。留空时自动取正文第一个标题或首行。"),
				"content":     str("笔记正文，Markdown 格式。建议用 # 标题、列表、表格、代码块组织内容。"),
				"notebook":    str("笔记本名称，例如「工作项目」。不存在会自动创建；留空则放入未分类。"),
				"tags":        strArray("标签列表，例如 [\"项目文档\",\"架构\"]。不存在的标签会自动创建。"),
				"pinned":      boolean("是否置顶。"),
				"external_id": str("外部唯一标识（如仓库路径、文档 slug）。同一个 external_id 再次保存会更新原笔记。"),
				"if_exists":   strEnum("当同名笔记已存在时的处理方式：append 追加（默认）、replace 覆盖、skip 跳过且不修改原文。", "append", "replace", "skip"),
			}, "content"),
			Annotations: map[string]any{"title": "保存笔记", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false},
			handler:     s.handleSaveNote,
		},
		{
			Name:  "save_notes",
			Title: "批量保存笔记",
			Description: "一次性保存多篇笔记。适合把一个项目的多个文档、一组会议纪要或一份目录结构整体导入 Locknote。" +
				"所有笔记可以共享同一个默认笔记本。",
			InputSchema: object(map[string]any{
				"notes": map[string]any{
					"type":        "array",
					"description": "笔记数组，每项包含 title、content，可选 notebook、tags、external_id。",
					"items": object(map[string]any{
						"title":       str("标题"),
						"content":     str("Markdown 正文"),
						"notebook":    str("笔记本名称（可选）"),
						"tags":        strArray("标签（可选）"),
						"external_id": str("外部唯一标识（可选）"),
					}, "content"),
				},
				"notebook":  str("所有笔记的默认笔记本名称（单篇未指定时使用）。"),
				"tags":      strArray("给所有笔记追加的标签。"),
				"if_exists": strEnum("同名笔记处理方式：append（默认）、replace、skip 跳过且不修改原文。", "append", "replace", "skip"),
			}, "notes"),
			Annotations: map[string]any{"title": "批量保存笔记", "readOnlyHint": false, "destructiveHint": false},
			handler:     s.handleSaveNotes,
		},
		{
			Name:  "get_note",
			Title: "读取笔记",
			Description: "按 id 读取一篇笔记的完整 Markdown 正文与元信息。也可以只传 title（配合 notebook 缩小范围）。" +
				"在总结、续写或引用已有笔记前调用。",
			InputSchema: object(map[string]any{
				"id":       str("笔记 id，例如 note_xxx。"),
				"title":    str("笔记标题（当没有 id 时使用）。"),
				"notebook": str("可选，配合 title 使用以限定笔记本。"),
			}),
			Annotations: map[string]any{"title": "读取笔记", "readOnlyHint": true},
			handler:     s.handleGetNote,
		},
		{
			Name:  "update_note",
			Title: "更新笔记",
			Description: "修改已有笔记的标题、正文、笔记本、标签或置顶状态。只传需要修改的字段；" +
				"修改正文会保存历史版本。若只想在末尾追加内容，请用 append_to_note。",
			InputSchema: object(map[string]any{
				"id":       str("要更新的笔记 id。"),
				"title":    str("新标题（可选）。"),
				"content":  str("新的完整正文（可选，会替换原文）。"),
				"notebook": str("移动到某个笔记本（可选，不存在会自动创建）。"),
				"tags":     strArray("新的标签集合（可选，会替换原有标签）。"),
				"pinned":   boolean("置顶状态（可选）。"),
			}, "id"),
			Annotations: map[string]any{"title": "更新笔记", "readOnlyHint": false, "destructiveHint": true},
			handler:     s.handleUpdateNote,
		},
		{
			Name:        "append_to_note",
			Title:       "追加内容",
			Description: "在一篇已有笔记末尾追加 Markdown 片段（空行分隔）。适合「继续记录」「补充进展」「追加日志」这类场景。",
			InputSchema: object(map[string]any{
				"id":      str("目标笔记 id。"),
				"content": str("要追加的 Markdown 内容。"),
			}, "id", "content"),
			Annotations: map[string]any{"title": "追加内容", "readOnlyHint": false, "destructiveHint": false},
			handler:     s.handleAppendNote,
		},
		{
			Name:        "move_note",
			Title:       "移动笔记",
			Description: "把笔记移动到另一个笔记本（不存在会自动创建）。传入空字符串表示移到未分类。",
			InputSchema: object(map[string]any{
				"id":       str("笔记 id。"),
				"notebook": str("目标笔记本名称；留空表示未分类。"),
			}, "id"),
			Annotations: map[string]any{"title": "移动笔记", "readOnlyHint": false, "destructiveHint": false},
			handler:     s.handleMoveNote,
		},
		{
			Name:        "delete_note",
			Title:       "删除笔记",
			Description: "把笔记移到回收站（默认，可恢复）。设置 hard=true 会永久删除，仅在用户明确要求时使用。",
			InputSchema: object(map[string]any{
				"id":   str("笔记 id。"),
				"hard": boolean("是否永久删除，默认 false（进回收站）。"),
			}, "id"),
			Annotations: map[string]any{"title": "删除笔记", "readOnlyHint": false, "destructiveHint": true},
			handler:     s.handleDeleteNote,
		},
		{
			Name:        "restore_note",
			Title:       "恢复笔记",
			Description: "从回收站恢复一篇笔记。",
			InputSchema: object(map[string]any{
				"id": str("笔记 id。"),
			}, "id"),
			Annotations: map[string]any{"title": "恢复笔记", "readOnlyHint": false, "destructiveHint": false},
			handler:     s.handleRestoreNote,
		},
		{
			Name:  "list_notes",
			Title: "列出笔记",
			Description: "按范围、笔记本、标签或关键词列出笔记（返回标题、摘要、时间，不含正文）。" +
				"用于浏览结构、了解某个笔记本里有什么。",
			InputSchema: object(map[string]any{
				"notebook": str("按笔记本名称筛选。"),
				"tag":      str("按标签筛选（不区分大小写），可与 notebook、scope、query 组合使用。"),
				"scope":    strEnum("范围：all 全部（默认）、pinned 置顶、uncategorized 未分类、recent 最近 30 天、ai AI 创建、trash 回收站。", "all", "pinned", "uncategorized", "recent", "ai", "trash"),
				"query":    str("在标题、正文和标签中做模糊匹配的关键词。"),
				"sort":     strEnum("排序：updated 最近更新（默认）、created 最近创建、title 标题、words 字数。", "updated", "created", "title", "words"),
				"limit":    integer("返回条数，默认 20，最大 100。"),
				"offset":   integer("跳过条数，用于分页。"),
			}),
			Annotations: map[string]any{"title": "列出笔记", "readOnlyHint": true},
			handler:     s.handleListNotes,
		},
		{
			Name:        "search_notes",
			Title:       "搜索笔记",
			Description: "全文搜索笔记（标题、正文、标签）。需要找「之前写过的某个东西」时优先用它。",
			InputSchema: object(map[string]any{
				"query":    str("搜索关键词。"),
				"notebook": str("可选，限定在某个笔记本内搜索。"),
				"limit":    integer("返回条数，默认 10。"),
			}, "query"),
			Annotations: map[string]any{"title": "搜索笔记", "readOnlyHint": true},
			handler:     s.handleSearchNotes,
		},
		{
			Name:        "list_notebooks",
			Title:       "列出笔记本",
			Description: "列出所有笔记本及其笔记数量。保存笔记前可以先看有哪些笔记本可以复用。",
			InputSchema: object(map[string]any{}),
			Annotations: map[string]any{"title": "列出笔记本", "readOnlyHint": true},
			handler:     s.handleListNotebooks,
		},
		{
			Name:        "create_notebook",
			Title:       "创建笔记本",
			Description: "创建一个新的笔记本。已存在同名笔记本时直接返回它，不修改任何数据、不记活动。",
			InputSchema: object(map[string]any{
				"name":        str("笔记本名称。"),
				"description": str("可选的说明。"),
			}, "name"),
			Annotations: map[string]any{"title": "创建笔记本", "readOnlyHint": false},
			handler:     s.handleCreateNotebook,
		},
		{
			Name:        "list_tags",
			Title:       "列出标签",
			Description: "列出所有标签及其使用次数。",
			InputSchema: object(map[string]any{}),
			Annotations: map[string]any{"title": "列出标签", "readOnlyHint": true},
			handler:     s.handleListTags,
		},
		{
			Name:  "workspace_overview",
			Title: "工作区概览",
			Description: "获取笔记库的整体情况：笔记总数、字数、笔记本分布、最近编辑的笔记、最近的 AI 写入活动。" +
				"在开始处理任务前调用它，可以快速了解用户已经记录了什么。" +
				"「AI 写入」按笔记的写入来源统计且只计未删除笔记，与列表里的 [AI] 标记（回收站笔记也会标记）口径不同。",
			InputSchema: object(map[string]any{}),
			Annotations: map[string]any{"title": "工作区概览", "readOnlyHint": true},
			handler:     s.handleOverview,
		},
	}
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

// defaultNotebookForAI applies the notebook configured in Settings when a
// caller does not provide one. An explicit notebook always wins.
func (s *Server) defaultNotebookForAI(tc *Context, notebook string) string {
	if strings.TrimSpace(notebook) != "" {
		return notebook
	}
	return tc.Store.GetSetting("ui.aiNotebook", "")
}

func (s *Server) handleSaveNote(tc *Context, args map[string]any) ToolResult {
	content := firstNonEmpty(argString(args, "content"), argString(args, "markdown"), argString(args, "body"), argString(args, "text"))
	if strings.TrimSpace(content) == "" {
		return errorResult("content 不能为空：请把要保存的 Markdown 正文放进 content 字段。")
	}
	pinned, hasPinned := argBool(args, "pinned")
	in := store.NoteInput{
		Title:      argString(args, "title"),
		Content:    content,
		Notebook:   s.defaultNotebookForAI(tc, argString(args, "notebook")),
		Tags:       argStrings(args, "tags"),
		Source:     "mcp",
		Author:     tc.Client,
		ExternalID: argString(args, "external_id"),
		IfExists:   defaultIfExists(argString(args, "if_exists")),
	}
	if hasPinned {
		in.Pinned = &pinned
	}

	note, created, err := tc.Store.UpsertNote(in)
	if err != nil {
		return errorResult("保存失败：%v", err)
	}

	// UpsertNote returns created=false for every "existing note" branch, so
	// !created plus skip is exactly the case where nothing was written at all.
	// Reporting it as an update would mislead the caller into thinking its
	// content had been overwritten.
	skipped := !created && in.IfExists == "skip"

	// A skipped save must neither pollute the activity feed nor trigger a UI
	// refresh — no note actually changed.
	if !skipped {
		if created {
			s.record(tc, "note.created", note.ID, note.Title, toolSummary(note))
			s.notifyChange("note.created", note)
		} else {
			s.record(tc, "note.updated", note.ID, note.Title, toolSummary(note))
			s.notifyChange("note.updated", note)
		}
	}

	action := "updated"
	if created {
		action = "created"
	}
	var text string
	if skipped {
		action = "skipped"
		text = fmt.Sprintf("已跳过：《%s》已存在，按 if_exists=skip 未作任何修改。\n- id: %s\n- 笔记本: %s\n- %s\n- 更新时间: %s\n- 链接: %s",
			note.Title, note.ID, orDash(note.NotebookName), noteFacts(note),
			note.UpdatedAt.Local().Format("2006-01-02 15:04"), s.noteLink(note))
	} else {
		verb := "已更新"
		if created {
			verb = "已保存"
		}
		text = fmt.Sprintf("%s《%s》到 Locknote。\n- id: %s\n- 笔记本: %s\n- %s\n- 更新时间: %s\n- 链接: %s",
			verb, note.Title, note.ID, orDash(note.NotebookName), noteFacts(note),
			note.UpdatedAt.Local().Format("2006-01-02 15:04"), s.noteLink(note))
	}

	return textResultWithData(text, map[string]any{
		"id":        note.ID,
		"title":     note.Title,
		"notebook":  note.NotebookName,
		"tags":      note.Tags,
		"created":   created,
		"skipped":   skipped,
		"action":    action,
		"wordCount": note.WordCount,
		"url":       s.noteLink(note),
		"updatedAt": note.UpdatedAt,
	})
}

func (s *Server) handleSaveNotes(tc *Context, args map[string]any) ToolResult {
	raw, ok := args["notes"].([]any)
	if !ok || len(raw) == 0 {
		return errorResult("notes 不能为空：请传入 [{title, content}, ...] 数组。")
	}
	defaultNotebook := s.defaultNotebookForAI(tc, argString(args, "notebook"))
	commonTags := argStrings(args, "tags")
	ifExists := defaultIfExists(argString(args, "if_exists"))

	saved := make([]*store.Note, 0, len(raw))
	failed, createdCount, updatedCount, skippedCount := 0, 0, 0, 0
	var lines []string
	for i, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			failed++
			lines = append(lines, fmt.Sprintf("%d. 跳过：条目格式不正确", i+1))
			continue
		}
		content := firstNonEmpty(argString(m, "content"), argString(m, "markdown"), argString(m, "body"))
		if strings.TrimSpace(content) == "" {
			failed++
			lines = append(lines, fmt.Sprintf("%d. 跳过：content 为空", i+1))
			continue
		}
		nb := argString(m, "notebook")
		if nb == "" {
			nb = defaultNotebook
		}
		tags := append(append([]string{}, commonTags...), argStrings(m, "tags")...)

		n, created, err := tc.Store.UpsertNote(store.NoteInput{
			Title:      argString(m, "title"),
			Content:    content,
			Notebook:   nb,
			Tags:       tags,
			Source:     "mcp",
			Author:     tc.Client,
			ExternalID: argString(m, "external_id"),
			IfExists:   ifExists,
		})
		if err != nil {
			failed++
			lines = append(lines, fmt.Sprintf("%d. 失败：%v", i+1, err))
			continue
		}
		saved = append(saved, n)
		// Same distinction as save_note: skip means "nothing was written", so
		// it must not be labelled or logged as an update.
		if !created && ifExists == "skip" {
			skippedCount++
			lines = append(lines, fmt.Sprintf("%d. 跳过（已存在，未修改）《%s》 · id %s", i+1, n.Title, n.ID))
			continue
		}
		kind := "note.updated"
		label := "更新"
		if created {
			kind = "note.created"
			label = "新建"
			createdCount++
		} else {
			updatedCount++
		}
		s.record(tc, kind, n.ID, n.Title, toolSummary(n))
		s.notifyChange(kind, n)
		lines = append(lines, fmt.Sprintf("%d. %s《%s》 · %s · id %s", i+1, label, n.Title, orDash(n.NotebookName), n.ID))
	}

	text := fmt.Sprintf("共处理 %d 篇笔记（成功 %d，失败 %d；新建 %d，更新 %d，跳过 %d）。\n\n%s",
		len(raw), len(saved), failed, createdCount, updatedCount, skippedCount, strings.Join(lines, "\n"))
	return textResultWithData(text, map[string]any{
		"total":    len(raw),
		"saved":    len(saved),
		"failed":   failed,
		"created":  createdCount,
		"updated":  updatedCount,
		"skipped":  skippedCount,
		"notes":    saved,
		"notebook": defaultNotebook,
	})
}

func (s *Server) handleGetNote(tc *Context, args map[string]any) ToolResult {
	note, err := s.lookupNote(tc, argString(args, "id"), argString(args, "title"), argString(args, "notebook"))
	if err != nil {
		return errorResult("%v", err)
	}
	header := fmt.Sprintf("# %s\n\n> id: %s · 笔记本: %s · 标签: %s · %d 字 · 更新于 %s\n\n",
		note.Title, note.ID, orDash(note.NotebookName), orDash(strings.Join(note.Tags, ", ")),
		note.WordCount, note.UpdatedAt.Local().Format("2006-01-02 15:04"))
	return textResultWithData(header+note.Content, map[string]any{
		"id":        note.ID,
		"title":     note.Title,
		"content":   note.Content,
		"notebook":  note.NotebookName,
		"tags":      note.Tags,
		"pinned":    note.Pinned,
		"createdAt": note.CreatedAt,
		"updatedAt": note.UpdatedAt,
		"url":       s.noteLink(note),
	})
}

func (s *Server) handleUpdateNote(tc *Context, args map[string]any) ToolResult {
	id := argString(args, "id")
	if id == "" {
		note, err := s.lookupNote(tc, "", argString(args, "title"), argString(args, "notebook"))
		if err != nil {
			return errorResult("%v", err)
		}
		id = note.ID
	}
	patch := store.NotePatch{Source: "mcp"}
	if v, ok := args["title"]; ok && v != nil {
		t := argString(args, "title")
		patch.Title = &t
	}
	if v, ok := args["content"]; ok && v != nil {
		c := argString(args, "content")
		patch.Content = &c
	}
	if v, ok := args["notebook"]; ok && v != nil {
		nb := argString(args, "notebook")
		patch.Notebook = &nb
	}
	if v, ok := args["tags"]; ok && v != nil {
		tags := argStrings(args, "tags")
		patch.Tags = &tags
	}
	if p, ok := argBool(args, "pinned"); ok {
		patch.Pinned = &p
	}

	note, err := tc.Store.UpdateNote(id, patch)
	if err != nil {
		if err == store.ErrNotFound {
			return errorResult("找不到 id 为 %s 的笔记。", id)
		}
		return errorResult("更新失败：%v", err)
	}
	s.record(tc, "note.updated", note.ID, note.Title, toolSummary(note))
	s.notifyChange("note.updated", note)

	return textResultWithData(fmt.Sprintf("已更新《%s》。\n- id: %s\n- 笔记本: %s\n- %s\n- 链接: %s",
		note.Title, note.ID, orDash(note.NotebookName), noteFacts(note), s.noteLink(note)),
		map[string]any{"id": note.ID, "title": note.Title, "notebook": note.NotebookName,
			"tags": note.Tags, "wordCount": note.WordCount, "updatedAt": note.UpdatedAt, "url": s.noteLink(note)})
}

func (s *Server) handleAppendNote(tc *Context, args map[string]any) ToolResult {
	id := argString(args, "id")
	content := firstNonEmpty(argString(args, "content"), argString(args, "markdown"))
	if strings.TrimSpace(content) == "" {
		return errorResult("content 不能为空。")
	}
	if id == "" {
		return errorResult("id 不能为空：请先确认要追加到哪篇笔记。")
	}
	note, err := tc.Store.AppendToNote(id, content)
	if err != nil {
		if err == store.ErrNotFound {
			return errorResult("找不到 id 为 %s 的笔记。", id)
		}
		return errorResult("追加失败：%v", err)
	}
	s.record(tc, "note.appended", note.ID, note.Title, toolSummary(note))
	s.notifyChange("note.updated", note)

	return textResultWithData(fmt.Sprintf("已追加 %d 字到《%s》（现共 %d 字）。\n- 链接: %s",
		textutil.WordCount(content), note.Title, note.WordCount, s.noteLink(note)),
		map[string]any{"id": note.ID, "title": note.Title, "wordCount": note.WordCount, "updatedAt": note.UpdatedAt})
}

func (s *Server) handleMoveNote(tc *Context, args map[string]any) ToolResult {
	id := argString(args, "id")
	if id == "" {
		return errorResult("id 不能为空。")
	}
	nb := argString(args, "notebook")
	if err := tc.Store.MoveNote(id, nb); err != nil {
		if err == store.ErrNotFound {
			return errorResult("找不到 id 为 %s 的笔记。", id)
		}
		return errorResult("移动失败：%v", err)
	}
	note, err := tc.Store.GetNote(id)
	if err != nil {
		return errorResult("移动后读取失败：%v", err)
	}
	s.record(tc, "note.moved", note.ID, note.Title, "移动到 "+orDash(note.NotebookName))
	s.notifyChange("note.updated", note)
	return textResult("已把《%s》移动到「%s」。", note.Title, orDash(note.NotebookName))
}

func (s *Server) handleDeleteNote(tc *Context, args map[string]any) ToolResult {
	id := argString(args, "id")
	if id == "" {
		return errorResult("id 不能为空。")
	}
	note, err := tc.Store.GetNote(id)
	if err != nil {
		return errorResult("找不到 id 为 %s 的笔记。", id)
	}
	hard, _ := argBool(args, "hard")
	if hard {
		if err := tc.Store.HardDelete(id); err != nil {
			return errorResult("永久删除失败：%v", err)
		}
		s.record(tc, "note.deleted", id, note.Title, "永久删除")
		s.notifyChange("note.deleted", note)
		return textResult("已永久删除《%s》。", note.Title)
	}
	if err := tc.Store.SoftDelete(id); err != nil {
		return errorResult("删除失败：%v", err)
	}
	s.record(tc, "note.trashed", id, note.Title, "移到回收站")
	s.notifyChange("note.deleted", note)
	return textResult("已把《%s》移到回收站，可以在 Locknote 里恢复。", note.Title)
}

func (s *Server) handleRestoreNote(tc *Context, args map[string]any) ToolResult {
	id := argString(args, "id")
	if id == "" {
		return errorResult("id 不能为空。")
	}
	if err := tc.Store.Restore(id); err != nil {
		if err == store.ErrNotFound {
			return errorResult("回收站里没有 id 为 %s 的笔记。", id)
		}
		return errorResult("恢复失败：%v", err)
	}
	note, err := tc.Store.GetNote(id)
	if err != nil {
		return errorResult("恢复后读取失败：%v", err)
	}
	s.record(tc, "note.restored", note.ID, note.Title, "从回收站恢复")
	s.notifyChange("note.updated", note)
	return textResult("已恢复《%s》。", note.Title)
}

func (s *Server) handleListNotes(tc *Context, args map[string]any) ToolResult {
	f := store.ListFilter{
		Scope:  argString(args, "scope"),
		Tag:    argString(args, "tag"),
		Query:  argString(args, "query"),
		Sort:   argString(args, "sort"),
		Limit:  clamp(argInt(args, "limit", 20), 1, 100),
		Offset: argInt(args, "offset", 0),
	}
	if nbName := argString(args, "notebook"); nbName != "" {
		nb, err := tc.Store.GetNotebookByName(nbName)
		if err != nil {
			names, _ := tc.Store.ListNotebooks()
			return errorResult("找不到笔记本「%s」。现有笔记本：%s", nbName, notebookNames(names))
		}
		f.Scope = "notebook"
		f.NotebookID = nb.ID
	}
	if f.Scope == "" {
		f.Scope = "all"
	}

	notes, total, err := tc.Store.ListNotes(f)
	if err != nil {
		return errorResult("查询失败：%v", err)
	}
	if len(notes) == 0 {
		return textResult("没有找到符合条件的笔记。")
	}
	return textResultWithData(formatNoteList(notes, total, f.Offset), map[string]any{
		"total": total, "count": len(notes), "offset": f.Offset,
		"notes": summarizeForJSON(notes),
	})
}

func (s *Server) handleSearchNotes(tc *Context, args map[string]any) ToolResult {
	query := argString(args, "query")
	if strings.TrimSpace(query) == "" {
		return errorResult("query 不能为空。")
	}
	f := store.ListFilter{
		Scope: "all",
		Query: query,
		Sort:  "updated",
		Limit: clamp(argInt(args, "limit", 10), 1, 50),
	}
	if nbName := argString(args, "notebook"); nbName != "" {
		if nb, err := tc.Store.GetNotebookByName(nbName); err == nil {
			f.Scope = "notebook"
			f.NotebookID = nb.ID
		}
	}
	notes, total, err := tc.Store.ListNotes(f)
	if err != nil {
		return errorResult("搜索失败：%v", err)
	}
	if len(notes) == 0 {
		return textResult("没有搜索到与「%s」相关的笔记。", query)
	}
	head := fmt.Sprintf("搜索「%s」命中 %d 篇：\n\n", query, total)
	return textResultWithData(head+formatNoteList(notes, total, 0), map[string]any{
		"query": query, "total": total, "notes": summarizeForJSON(notes),
	})
}

func (s *Server) handleListNotebooks(tc *Context, _ map[string]any) ToolResult {
	nbs, err := tc.Store.ListNotebooks()
	if err != nil {
		return errorResult("读取笔记本失败：%v", err)
	}
	if len(nbs) == 0 {
		return textResult("还没有笔记本。")
	}
	var b strings.Builder
	b.WriteString("笔记本列表：\n\n| 名称 | 笔记数 | 说明 |\n| --- | --- | --- |\n")
	for _, nb := range nbs {
		b.WriteString(fmt.Sprintf("| %s | %d | %s |\n", nb.Name, nb.Count, orDash(nb.Description)))
	}
	return textResultWithData(b.String(), map[string]any{"notebooks": nbs})
}

func (s *Server) handleCreateNotebook(tc *Context, args map[string]any) ToolResult {
	name := argString(args, "name")
	if strings.TrimSpace(name) == "" {
		return errorResult("name 不能为空。")
	}
	nb, created, err := tc.Store.CreateNotebook(name, "", "", argString(args, "description"))
	if err != nil {
		return errorResult("创建笔记本失败：%v", err)
	}
	if !created {
		// Idempotent hit: nothing was written, so do not claim a creation in the
		// activity feed or tell the UI that the library changed.
		return textResultWithData(fmt.Sprintf("笔记本「%s」已存在（当前 %d 篇笔记），未作任何修改。", nb.Name, nb.Count),
			map[string]any{"id": nb.ID, "name": nb.Name, "count": nb.Count, "created": false, "action": "unchanged"})
	}
	s.record(tc, "notebook.created", "", nb.Name, "新建笔记本")
	return textResultWithData(fmt.Sprintf("已新建笔记本「%s」（当前 %d 篇笔记）。", nb.Name, nb.Count),
		map[string]any{"id": nb.ID, "name": nb.Name, "count": nb.Count, "created": true, "action": "created"})
}

func (s *Server) handleListTags(tc *Context, _ map[string]any) ToolResult {
	tags, err := tc.Store.ListTags()
	if err != nil {
		return errorResult("读取标签失败：%v", err)
	}
	if len(tags) == 0 {
		return textResult("还没有标签。")
	}
	var b strings.Builder
	b.WriteString("标签：\n\n")
	for _, t := range tags {
		b.WriteString(fmt.Sprintf("- %s（%d 篇）\n", t.Name, t.Count))
	}
	return textResultWithData(b.String(), map[string]any{"tags": tags})
}

func (s *Server) handleOverview(tc *Context, _ map[string]any) ToolResult {
	st, err := tc.Store.GetStats()
	if err != nil {
		return errorResult("读取统计失败：%v", err)
	}
	nbs, _ := tc.Store.ListNotebooks()
	tags, _ := tc.Store.ListTags()
	recent, _, _ := tc.Store.ListNotes(store.ListFilter{Scope: "all", Sort: "updated", Limit: 8})
	activity, _ := tc.Store.Activity(8)

	var b strings.Builder
	b.WriteString("# Locknote 概览\n\n")
	b.WriteString(fmt.Sprintf("- 笔记 %d 篇（回收站 %d 篇，置顶 %d 篇）\n", st.Notes, st.Trash, st.Pinned))
	b.WriteString(fmt.Sprintf("- 笔记本 %d 个，标签 %d 个，总字数约 %d\n", st.Notebooks, st.Tags, st.Words))
	b.WriteString(fmt.Sprintf("- AI 写入 %d 篇（按来源统计，不含回收站），今天更新 %d 篇\n", st.FromAI, st.UpdatedToday))
	if st.LastUpdated != nil {
		b.WriteString(fmt.Sprintf("- 最近更新：%s\n", st.LastUpdated.Local().Format("2006-01-02 15:04")))
	}
	if len(nbs) > 0 {
		b.WriteString("\n## 笔记本\n\n")
		for _, nb := range nbs {
			b.WriteString(fmt.Sprintf("- %s：%d 篇\n", nb.Name, nb.Count))
		}
	}
	if len(tags) > 0 {
		b.WriteString("\n## 标签\n\n")
		names := make([]string, 0, len(tags))
		for _, t := range tags {
			names = append(names, fmt.Sprintf("%s(%d)", t.Name, t.Count))
		}
		b.WriteString(strings.Join(names, "、") + "\n")
	}
	if len(recent) > 0 {
		b.WriteString("\n## 最近编辑\n\n")
		for _, n := range recent {
			b.WriteString(fmt.Sprintf("- %s · %s · %s · id %s\n", n.Title,
				orDash(n.NotebookName), n.UpdatedAt.Local().Format("01-02 15:04"), n.ID))
		}
	}
	if len(activity) > 0 {
		b.WriteString("\n## 最近活动\n\n")
		for _, a := range activity {
			b.WriteString(fmt.Sprintf("- [%s] %s %s %s\n", a.Actor, a.CreatedAt.Local().Format("01-02 15:04"),
				activityLabel(a.Kind), a.NoteTitle))
		}
	}
	return textResultWithData(b.String(), map[string]any{
		"stats": st, "notebooks": nbs, "tags": tags,
		"recent": summarizeForJSON(recent), "activity": activity,
	})
}

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

func (s *Server) noteLink(n *store.Note) string {
	if s.BaseURL == "" {
		return "locknote://notes/" + n.ID
	}
	return fmt.Sprintf("%s/?note=%s", s.BaseURL, n.ID)
}

func (s *Server) lookupNote(tc *Context, id, title, notebook string) (*store.Note, error) {
	if id != "" {
		n, err := tc.Store.GetNote(id)
		if err == store.ErrNotFound {
			return nil, fmt.Errorf("找不到 id 为 %s 的笔记", id)
		}
		return n, err
	}
	if strings.TrimSpace(title) == "" {
		return nil, fmt.Errorf("请提供笔记 id，或提供 title 用于查找")
	}
	n, err := tc.Store.FindNoteByTitle(title, notebook)
	if err == store.ErrNotFound {
		return nil, fmt.Errorf("找不到标题为「%s」的笔记", title)
	}
	return n, err
}

func formatNoteList(notes []*store.Note, total, offset int) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("共 %d 篇，显示第 %d-%d 篇：\n\n", total, offset+1, offset+len(notes)))
	for i, n := range notes {
		flags := []string{}
		if n.Pinned {
			flags = append(flags, "置顶")
		}
		if n.Source != "web" {
			flags = append(flags, "AI")
		}
		suffix := ""
		if len(flags) > 0 {
			suffix = " [" + strings.Join(flags, "/") + "]"
		}
		b.WriteString(fmt.Sprintf("%d. **%s**%s\n   - id: %s\n   - 笔记本: %s · %s · %s\n   - 摘要: %s\n",
			offset+i+1, n.Title, suffix, n.ID, orDash(n.NotebookName),
			orDash(strings.Join(n.Tags, ", ")), n.UpdatedAt.Local().Format("2006-01-02 15:04"),
			orDash(n.Excerpt)))
	}
	return b.String()
}

func summarizeForJSON(notes []*store.Note) []map[string]any {
	out := make([]map[string]any, 0, len(notes))
	for _, n := range notes {
		out = append(out, map[string]any{
			"id":        n.ID,
			"title":     n.Title,
			"notebook":  n.NotebookName,
			"tags":      n.Tags,
			"excerpt":   n.Excerpt,
			"pinned":    n.Pinned,
			"source":    n.Source,
			"wordCount": n.WordCount,
			"createdAt": n.CreatedAt,
			"updatedAt": n.UpdatedAt,
		})
	}
	return out
}

func activityLabel(kind string) string {
	switch kind {
	case "note.created":
		return "新建"
	case "note.updated":
		return "更新"
	case "note.appended":
		return "追加"
	case "note.moved":
		return "移动"
	case "note.trashed":
		return "移入回收站"
	case "note.restored":
		return "恢复"
	case "note.deleted":
		return "删除"
	case "notebook.created":
		return "新建笔记本"
	default:
		return kind
	}
}

func notebookNames(nbs []store.Notebook) string {
	names := make([]string, 0, len(nbs))
	for _, nb := range nbs {
		names = append(names, nb.Name)
	}
	sort.Strings(names)
	return strings.Join(names, "、")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func defaultIfExists(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "replace", "skip", "append":
		return strings.ToLower(strings.TrimSpace(v))
	default:
		return "append"
	}
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
