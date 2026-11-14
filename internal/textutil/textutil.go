// Package textutil contains small helpers that understand Markdown well enough
// to derive a title, an excerpt and a word count from a note body.
package textutil

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	fenceRe      = regexp.MustCompile("(?s)```.*?```")
	inlineCodeRe = regexp.MustCompile("`([^`]*)`")
	imageRe      = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	linkRe       = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	headingRe    = regexp.MustCompile(`^\s{0,3}(#{1,6})\s+(.*)$`)
	htmlTagRe    = regexp.MustCompile(`<[^>]+>`)
	bulletRe     = regexp.MustCompile(`^\s*([-*+]|\d+\.)\s+`)
	multiSpaceRe = regexp.MustCompile(`\s+`)
)

// stripEmphasis removes Markdown emphasis delimiters for plain-text rendering.
// Underscores need special care: `_斜体_` is markup, but the underscore in
// `external_id` or `save_notes` is a literal character and must survive.
// An underscore run is treated as emphasis only when it touches a non-word
// rune or the edge of the text — the positions where Markdown would parse it
// as an opening/closing delimiter. Asterisks and tildes are always markup here.
func stripEmphasis(s string) string {
	r := []rune(s)
	var b strings.Builder
	b.Grow(len(r))
	for i := 0; i < len(r); {
		c := r[i]
		if c != '*' && c != '~' && c != '_' {
			b.WriteRune(c)
			i++
			continue
		}
		j := i
		for j < len(r) && r[j] == c && j-i < 3 {
			j++
		}
		if c == '_' && i > 0 && j < len(r) && isWordRune(r[i-1]) && isWordRune(r[j]) {
			for k := i; k < j; k++ {
				b.WriteRune('_')
			}
		}
		i = j
	}
	return b.String()
}

func isWordRune(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r)
}

// Plain converts Markdown into a single-line plain text rendering. It is used
// for excerpts and for search highlighting; it intentionally drops code fences
// and markup so the result reads like prose, while keeping snake_case
// identifiers intact so excerpts stay faithful to the source.
func Plain(markdown string) string {
	s := fenceRe.ReplaceAllString(markdown, " ")
	s = imageRe.ReplaceAllString(s, "$1")
	s = linkRe.ReplaceAllString(s, "$1")
	s = inlineCodeRe.ReplaceAllString(s, "$1")
	s = htmlTagRe.ReplaceAllString(s, " ")
	s = stripEmphasis(s)
	s = strings.ReplaceAll(s, ">", " ")
	s = strings.ReplaceAll(s, "|", " ")

	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = headingRe.ReplaceAllString(line, "$2")
		line = bulletRe.ReplaceAllString(line, "")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Trim(line, "-=*_ ") == "" {
			continue
		}
		out = append(out, line)
	}
	return strings.TrimSpace(multiSpaceRe.ReplaceAllString(strings.Join(out, " "), " "))
}

// Excerpt returns at most n runes of plain text, with an ellipsis when the
// content was truncated.
func Excerpt(markdown string, n int) string {
	p := Plain(markdown)
	r := []rune(p)
	if len(r) <= n {
		return p
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

// Title derives a title from the note body: the first Markdown heading, or the
// first meaningful line. The result is capped at 120 runes.
func Title(markdown string) string {
	lines := strings.Split(markdown, "\n")
	inFence := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "```") {
			inFence = !inFence
			continue
		}
		if inFence || line == "" {
			continue
		}
		if m := headingRe.FindStringSubmatch(line); m != nil {
			return clip(strings.TrimSpace(m[2]), 120)
		}
		// Skip pure front matter delimiters and horizontal rules.
		if line == "---" || line == "***" {
			continue
		}
		if strings.Trim(line, "-=*_ ") == "" {
			continue
		}
		candidate := bulletRe.ReplaceAllString(line, "")
		candidate = Plain(candidate)
		if candidate != "" {
			return clip(candidate, 120)
		}
	}
	return ""
}

// WordCount counts CJK characters individually and whitespace-separated words
// for the rest. That matches how Chinese and English note apps report length.
func WordCount(markdown string) int {
	count := 0
	inWord := false
	for _, r := range Plain(markdown) {
		switch {
		case unicode.Is(unicode.Han, r), unicode.Is(unicode.Hiragana, r), unicode.Is(unicode.Katakana, r), unicode.Is(unicode.Hangul, r):
			count++
			inWord = false
		case unicode.IsSpace(r):
			inWord = false
		default:
			if !inWord {
				count++
				inWord = true
			}
		}
	}
	return count
}

// CharCount counts non-space characters, which is what the editor footer shows.
func CharCount(markdown string) int {
	n := 0
	for _, r := range Plain(markdown) {
		if !unicode.IsSpace(r) {
			n++
		}
	}
	return n
}

// Slug makes a filesystem/URL friendly identifier out of a title.
func Slug(s string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevDash = false
		case r == ' ' || r == '-' || r == '_' || r == '/':
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func clip(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}
