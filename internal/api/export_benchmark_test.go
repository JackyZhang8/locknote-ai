package api

import (
	"archive/zip"
	"context"
	"database/sql"
	"fmt"
	"io"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"locknote-mcp/internal/store"
)

// Run with -run '^$' -bench BenchmarkExportPipeline -benchtime=1x -count=1.
// The isolated 64 MiB fixture bypasses write triggers; only export is measured.
// Sampled Go heap is an approximation, not process RSS.
func BenchmarkExportPipeline(b *testing.B) {
	location := filepath.Join(b.TempDir(), "export.db")
	st, err := store.Open(location)
	if err != nil {
		b.Fatal(err)
	}
	defer st.Close()
	seed, err := sql.Open("sqlite", "file:"+location)
	if err != nil {
		b.Fatal(err)
	}
	defer seed.Close()
	rows, err := seed.Query("SELECT name FROM sqlite_master WHERE type='trigger'")
	if err != nil {
		b.Fatal(err)
	}
	var triggers []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			b.Fatal(err)
		}
		triggers = append(triggers, name)
	}
	if err := rows.Close(); err != nil {
		b.Fatal(err)
	}
	for _, name := range triggers {
		if _, err := seed.Exec("DROP TRIGGER " + name); err != nil {
			b.Fatal(err)
		}
	}
	if _, err := seed.Exec("DELETE FROM notes"); err != nil {
		b.Fatal(err)
	}
	// A repeatable mix of Markdown words; each body is exactly 64 KiB.
	body := make([]byte, 64<<10)
	phrase := []byte("# Project notes\nStreaming Markdown export with notebooks and tags.\n")
	for i := range body {
		body[i] = phrase[i%len(phrase)]
	}
	tx, err := seed.Begin()
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < 1024; i++ {
		if _, err := tx.Exec("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)", fmt.Sprintf("note_%08d", i), "export", string(body), "", ""); err != nil {
			b.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	measure := func(b *testing.B, run func() error) {
		b.ReportAllocs()
		var peak uint64
		for i := 0; i < b.N; i++ {
			b.StopTimer()
			runtime.GC()
			var before runtime.MemStats
			runtime.ReadMemStats(&before)
			var high atomic.Uint64
			high.Store(before.HeapAlloc)
			done := make(chan struct{})
			joined := make(chan struct{})
			go func() {
				defer close(joined)
				ticker := time.NewTicker(2 * time.Millisecond)
				defer ticker.Stop()
				for {
					select {
					case <-done:
						return
					case <-ticker.C:
						var m runtime.MemStats
						runtime.ReadMemStats(&m)
						if m.HeapAlloc > high.Load() {
							high.Store(m.HeapAlloc)
						}
					}
				}
			}()
			b.StartTimer()
			err := run()
			b.StopTimer()
			close(done)
			<-joined
			if err != nil {
				b.Fatal(err)
			}
			delta := high.Load() - before.HeapAlloc
			if delta > peak {
				peak = delta
			}
		}
		b.ReportMetric(float64(peak)/(1<<20), "MiB-heap-peak")
	}
	b.Run("all-bodies-loaded", func(b *testing.B) {
		measure(b, func() error {
			notes, err := st.AllLiveNotes()
			if err != nil {
				return err
			}
			zw := zip.NewWriter(io.Discard)
			for i, note := range notes {
				if err := writeZipEntry(zw, fmt.Sprintf("notes/%d.md", i), renderMarkdownFile(note)); err != nil {
					return err
				}
			}
			return zw.Close()
		})
	})
	b.Run("bounded-snapshot-pipeline", func(b *testing.B) {
		measure(b, func() error {
			snapshot, err := st.OpenNoteExport(context.Background())
			if err != nil {
				return err
			}
			defer snapshot.Close()
			return streamMarkdownZIP(context.Background(), io.Discard, snapshot.Count, snapshot.NextBatch)
		})
	})
}
