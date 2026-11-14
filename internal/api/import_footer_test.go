package api

import (
	"locknote-mcp/internal/store"
	"strings"
	"testing"
)

func TestMarkdownFooter(t *testing.T) {
	n := &store.Note{Title: "test", NotebookName: "work", Tags: []string{"a,b"}, Content: "# body"}
	s := renderMarkdownFile(n)
	if !strings.HasPrefix(s, n.Content) || !strings.Contains(s, "<!-- locknote:metadata:v1") {
		t.Fatal("missing footer")
	}
	title, nb, tags, body := parseMarkdownImport("test.md", s)
	if title != n.Title || nb != n.NotebookName || strings.Join(tags, "|") != "a,b" || body != n.Content {
		t.Fatal("roundtrip failed")
	}
}
