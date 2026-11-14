package textutil

import (
	"strings"
	"testing"
)

// Regression: excerpts used to turn external_id into externalid because the
// emphasis regexp stripped every underscore.
func TestPlainKeepsSnakeCaseIdentifiers(t *testing.T) {
	cases := []struct {
		name, markdown, want string
	}{
		{
			"identifiers",
			"调用 `external_id`，再试 save_notes 与 update_note",
			"调用 external_id，再试 save_notes 与 update_note",
		},
		{
			"emphasis still stripped",
			"这是 **加粗**、_斜体_ 与 ~~删除线~~ 的混合",
			"这是 加粗、斜体 与 删除线 的混合",
		},
		{
			"emphasis around an identifier",
			"_external_id_ 保持不变",
			"external_id 保持不变",
		},
		{
			"multiple underscores inside a word",
			"a_b_c 和 __private_field__ 的片段",
			"a_b_c 和 private_field 的片段",
		},
		{
			"headings and bullets",
			"# 标题\n\n- **要点**：看 save_nes 参数\n",
			"标题 要点：看 save_nes 参数",
		},
	}
	for _, c := range cases {
		got := Plain(c.markdown)
		if got != c.want {
			t.Errorf("%s: Plain = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestExcerptKeepsIdentifiers(t *testing.T) {
	got := Excerpt("external_id 用于幂等更新；save_notes 可以一次写入多篇。", 200)
	for _, want := range []string{"external_id", "save_notes"} {
		if !strings.Contains(got, want) {
			t.Errorf("excerpt %q should contain %q", got, want)
		}
	}
	if strings.Contains(got, "externalid") {
		t.Errorf("excerpt %q mangled an identifier", got)
	}
}

func TestWordCountWithIdentifiers(t *testing.T) {
	// An identifier is one word, with or without its underscore.
	if got, want := WordCount("external_id"), 1; got != want {
		t.Errorf("WordCount(external_id) = %d, want %d", got, want)
	}
	// CJK characters count individually: 中文(2) + save_notes(1) + 参数(2).
	if got, want := WordCount("中文 save_notes 参数"), 5; got != want {
		t.Errorf("WordCount mixed = %d, want %d", got, want)
	}
}
