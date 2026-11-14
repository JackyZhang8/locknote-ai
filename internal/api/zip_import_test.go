package api

import (
	"archive/zip"
	"bytes"
	"locknote-mcp/internal/store"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestZIPImportRestoresMetadata(t *testing.T) {
	s := settingsServer(t)
	note := &store.Note{Title: "roundtrip", NotebookName: "new notebook", Tags: []string{"a,b", "tag"}, Content: "# body"}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	_ = writeZipEntry(zw, "notes/test.md", renderMarkdownFile(note))
	_ = writeZipEntry(zw, "README.md", "# LockNote.ai export")
	_ = zw.Close()
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, _ := writer.CreateFormFile("files", "backup.zip")
	_, _ = part.Write(archive.Bytes())
	_ = writer.Close()
	req := httptest.NewRequest("POST", "/api/import", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	s.handleImportMarkdown(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"created":1`) {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	notes, _, err := s.store.ListNotes(store.ListFilter{Scope: "all", Query: "roundtrip", WithBody: true})
	if err != nil || len(notes) != 1 {
		t.Fatalf("notes: %v %v", notes, err)
	}
	got := notes[0]
	if got.NotebookName != note.NotebookName || got.Content != note.Content || strings.Join(got.Tags, "|") != strings.Join(note.Tags, "|") {
		t.Fatalf("metadata lost: %+v", got)
	}
}
