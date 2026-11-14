package api

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"locknote-mcp/internal/store"
)

func TestStreamingExportPreservesEveryNoteAndMetadata(t *testing.T) {
	var index int
	next := func(ctx context.Context) ([]*store.Note, error) {
		if index >= 300 {
			return nil, io.EOF
		}
		batch := []*store.Note{}
		for i := 0; i < 7 && index < 300; i++ {
			// Same title and same first eight ID characters must never collide.
			batch = append(batch, &store.Note{ID: strings.Repeat("a", 8) + string(rune(0x4e00+index)), Title: "same", Content: "body", NotebookName: "work", Tags: []string{"a,b", "tag"}})
			index++
		}
		return batch, nil
	}
	var output bytes.Buffer
	if err := streamMarkdownZIP(context.Background(), &output, 300, next); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	count := 0
	for _, entry := range archive.File {
		if names[entry.Name] {
			t.Fatalf("duplicate filename: %s", entry.Name)
		}
		names[entry.Name] = true
		r, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(entry.Name, "notes/") {
			count++
			title, nb, tags, body := parseMarkdownImport(entry.Name, string(data))
			if title != "same" || nb != "work" || body != "body" || strings.Join(tags, "|") != "a,b|tag" {
				t.Fatalf("bad metadata: %s", data)
			}
		}
	}
	if count != 300 {
		t.Fatalf("count %d", count)
	}
}

type failedExportWriter struct{}

func (failedExportWriter) Write(p []byte) (int, error) { return 0, io.ErrClosedPipe }

func TestExportOutputFailureCancelsBlockedProducer(t *testing.T) {
	var calls atomic.Int32
	stopped := make(chan struct{})
	next := func(ctx context.Context) ([]*store.Note, error) {
		if calls.Add(1) == 1 {
			return []*store.Note{{ID: "first", Content: "body"}}, nil
		}
		<-ctx.Done()
		close(stopped)
		return nil, ctx.Err()
	}
	done := make(chan error, 1)
	go func() { done <- streamMarkdownZIP(context.Background(), failedExportWriter{}, 2, next) }()
	select {
	case err := <-done:
		if !errors.Is(err, io.ErrClosedPipe) {
			t.Fatalf("write error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("failed output left producer running")
	}
	// Producer may be canceled before entering its second read.
	if calls.Load() > 1 {
		select {
		case <-stopped:
		default:
			t.Fatal("producer was not joined")
		}
	}
}

func TestExportCancellationStopsQueue(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := streamMarkdownZIP(ctx, io.Discard, 0, func(context.Context) ([]*store.Note, error) { t.Fatal("read after cancellation"); return nil, io.EOF })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}

type stalledExportWriter struct {
	ctx     context.Context
	entered chan struct{}
	once    atomic.Bool
}

func (w *stalledExportWriter) Write(p []byte) (int, error) {
	if w.once.CompareAndSwap(false, true) {
		close(w.entered)
	}
	<-w.ctx.Done()
	return 0, w.ctx.Err()
}

func TestSlowExportAppliesBackpressure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var reads atomic.Int32
	readTwo := make(chan struct{})
	next := func(ctx context.Context) ([]*store.Note, error) {
		count := reads.Add(1)
		if count == 2 {
			close(readTwo)
		}
		return []*store.Note{{ID: fmt.Sprint(count), Content: "body"}}, nil
	}
	output := &stalledExportWriter{ctx: ctx, entered: make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- streamMarkdownZIP(ctx, output, 10000, next) }()
	select {
	case <-output.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("no output")
	}
	select {
	case <-readTwo:
	case <-time.After(3 * time.Second):
		t.Fatal("producer did not prefetch")
	}
	if reads.Load() > 2 {
		t.Fatalf("unbounded prefetch while output stalled: %d", reads.Load())
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation did not join producer")
	}
}
