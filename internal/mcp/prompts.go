package mcp

import (
	"encoding/json"
	"fmt"
	"strings"
)

// promptList returns the reusable prompt templates exposed to clients.
func (s *Server) promptList() []Prompt {
	return []Prompt{
		{
			Name:        "save_project_docs",
			Title:       "把项目文档保存到 Locknote",
			Description: "引导模型梳理当前项目的文档，并按结构写入 Locknote 的某个笔记本。",
			Arguments: []PromptArgument{
				{Name: "project", Description: "项目名称，用作笔记本名。", Required: true},
				{Name: "focus", Description: "重点关注的内容，例如「架构与接口」「部署步骤」。", Required: false},
			},
		},
		{
			Name:        "summarize_notebook",
			Title:       "总结某个笔记本",
			Description: "读取一个笔记本里的笔记并生成结构化总结。",
			Arguments: []PromptArgument{
				{Name: "notebook", Description: "笔记本名称。", Required: true},
			},
		},
		{
			Name:        "daily_digest",
			Title:       "今日笔记速览",
			Description: "回顾最近编辑的笔记，生成一份简短的进展摘要。",
		},
	}
}

// getPrompt renders one prompt into messages.
func (s *Server) getPrompt(req *Request) (any, *RPCError) {
	var params struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return nil, NewError(CodeInvalidParams, "invalid params: %v", err)
	}
	args := params.Arguments
	if args == nil {
		args = map[string]string{}
	}

	var text string
	switch params.Name {
	case "save_project_docs":
		project := strings.TrimSpace(args["project"])
		if project == "" {
			project = "当前项目"
		}
		focus := strings.TrimSpace(args["focus"])
		if focus == "" {
			focus = "整体结构、关键设计、使用方式"
		}
		text = fmt.Sprintf(`请把我们正在处理的「%s」整理成结构化文档，并保存到 Locknote 笔记库。

要求：
1. 先调用 workspace_overview 了解已有内容，避免重复创建。
2. 把文档拆成若干篇独立笔记，例如：项目概览、架构设计、接口说明、部署与运行、常见问题。
3. 每篇用 save_note 保存，notebook 统一使用「%s」，tags 使用 [「%s」, 具体主题]。
4. 为每篇设置稳定的 external_id（如 %s/architecture），这样以后更新会覆盖原笔记而不是新建。
5. 正文使用规范 Markdown：一级标题、要点列表、必要时用表格和代码块。
6. 内容重点：%s。

最后告诉我保存了哪些笔记（标题 + id）。`, project, project, project, slugFor(project), focus)
	case "summarize_notebook":
		notebook := strings.TrimSpace(args["notebook"])
		if notebook == "" {
			notebook = "全部"
		}
		text = fmt.Sprintf(`请阅读 Locknote 中「%s」笔记本的内容并生成总结。

步骤：
1. 调用 list_notes，notebook="%s"，limit=50 获取笔记列表。
2. 对关键笔记调用 get_note 读取全文。
3. 输出：主题概览、主要结论、待办与未解决问题、建议下一步。
4. 如果总结本身有价值，用 save_note 保存成一篇标题为「%s · 总结」的笔记，notebook 保持为「%s」，tags 加上「总结」。`, notebook, notebook, notebook, notebook)
	case "daily_digest":
		text = `请回顾我在 Locknote 里最近的记录，生成一份今日速览。

步骤：
1. 调用 workspace_overview 获取概况。
2. 调用 list_notes，scope="recent"，limit=20，了解最近 30 天的笔记。
3. 输出三段：最近在推进什么、有哪些新想法、建议接下来做什么。
4. 如果发现值得继续的线索，用 save_note 写成「今日速览 · <日期>」，notebook 用「收集箱」，tags 用 ["速览"]。`
	default:
		return nil, NewError(CodeInvalidParams, "unknown prompt: %s", params.Name)
	}

	return map[string]any{
		"description": params.Name,
		"messages": []PromptMessage{
			{Role: "user", Content: Content{Type: "text", Text: text}},
		},
	}, nil
}

func slugFor(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			prevDash = false
		case r == ' ' || r == '-' || r == '_':
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "project"
	}
	return out
}
