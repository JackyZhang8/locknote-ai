package store

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// This opt-in benchmark uses synthetic content only, never the user's library.
func BenchmarkStartupScale(b *testing.B) {
	for _, count := range []int{100, 1000, 10000, 30000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			path := filepath.Join(b.TempDir(), "scale.db")
			st, err := Open(path)
			if err != nil {
				b.Fatal(err)
			}
			if _, err = st.db.Exec(dropTriggersSQL); err != nil {
				b.Fatal(err)
			}
			tx, err := st.db.Begin()
			if err != nil {
				b.Fatal(err)
			}
			stmt, err := tx.Prepare("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)")
			if err != nil {
				b.Fatal(err)
			}
			body := strings.Repeat("synthetic searchable content 测试笔记 ", 30)
			for i := 0; i < count; i++ {
				if _, err = stmt.Exec(fmt.Sprintf("scale-%d", i), fmt.Sprintf("Scale note %d", i), body, "2026-11-18T00:00:00Z", "2026-11-18T00:00:00Z"); err != nil {
					b.Fatal(err)
				}
			}
			stmt.Close()
			if err = tx.Commit(); err != nil {
				b.Fatal(err)
			}
			if err = st.RebuildIndexes(); err != nil {
				b.Fatal(err)
			}
			st.Close()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				start := time.Now()
				st, err = Open(path)
				if err != nil {
					b.Fatal(err)
				}
				elapsed := time.Since(start)
				var found int
				if err = st.db.QueryRow("SELECT count(*) FROM notes WHERE id LIKE 'scale-%'").Scan(&found); err != nil || found != count {
					b.Fatal("data mismatch", err)
				}
				check := time.Now()
				if err = st.CheckDatabase(); err != nil {
					b.Fatal(err)
				}
				b.ReportMetric(float64(time.Since(check).Microseconds())/1000, "check-ms")
				b.ReportMetric(float64(elapsed.Microseconds())/1000, "open-ms")
				st.Close()
			}
		})
	}
}
