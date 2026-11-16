package api

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"locknote-mcp/internal/store"
	"locknote-mcp/internal/textutil"
)

type exportBatch struct {
	notes []*store.Note
	err   error
}

type exportContextWriter struct {
	context.Context
	io.Writer
}

func (w exportContextWriter) Write(p []byte) (int, error) {
	if err := w.Err(); err != nil {
		return 0, err
	}
	return w.Writer.Write(p)
}

// streamMarkdownZIP keeps one queued batch, one being compressed, and at most
// one being read. Channel backpressure prevents a slow client loading the library.
// ZIP central-directory metadata still grows with file count, not body size.
func streamMarkdownZIP(parent context.Context, output io.Writer, total int,
	next func(context.Context) ([]*store.Note, error)) error {
	if err := parent.Err(); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(parent)
	batches := make(chan exportBatch, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer close(batches)
		for {
			if ctx.Err() != nil {
				return
			}
			notes, err := next(ctx)
			if err == io.EOF {
				return
			}
			select {
			case batches <- exportBatch{notes, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	defer func() { cancel(); <-done }()
	zw := zip.NewWriter(exportContextWriter{ctx, output})
	flush := func() error {
		if err := zw.Flush(); err != nil {
			return err
		}
		if f, ok := output.(http.Flusher); ok {
			f.Flush()
		}
		return ctx.Err()
	}
	readme := fmt.Sprintf("# LockNote.app export\n\nExported at: %s\nNotes: %d\n\nEvery note is a Markdown document with a versioned Locknote metadata footer.\n", time.Now().Format(time.RFC3339), total)
	if err := writeZipEntry(zw, "README.md", readme); err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	buffer := make([]byte, 32<<10)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case batch, ok := <-batches:
			if !ok {
				if err := ctx.Err(); err != nil {
					return err
				}
				return zw.Close()
			}
			if batch.err != nil {
				return batch.err
			}
			for _, note := range batch.notes {
				if err := ctx.Err(); err != nil {
					return err
				}
				base := []rune(textutil.Slug(note.Title))
				if len(base) > 60 {
					base = base[:60]
				}
				if len(base) == 0 {
					base = []rune("untitled")
				}
				// Full database IDs make names unique without a growing collision map.
				name := path.Join("notes", string(base)+"-"+textutil.Slug(note.ID)+".md")
				entry, err := zw.Create(name)
				if err != nil {
					return err
				}
				// Hide strings.Reader.WriteTo so CopyBuffer uses the bounded reusable
				// buffer rather than converting an entire large body into another []byte.
				body := io.LimitReader(strings.NewReader(note.Content), int64(len(note.Content)))
				if _, err := io.CopyBuffer(entry, body, buffer); err != nil {
					return err
				}
				if _, err := io.WriteString(entry, "\n\n"+metadataMarker); err != nil {
					return err
				}
				data, err := json.Marshal(markdownMetadata{note.Title, note.NotebookName, note.Tags})
				if err != nil {
					return err
				}
				if _, err := entry.Write(data); err != nil {
					return err
				}
				if _, err := io.WriteString(entry, "\n-->\n"); err != nil {
					return err
				}
			}
			if err := flush(); err != nil {
				return err
			}
		}
	}
}
