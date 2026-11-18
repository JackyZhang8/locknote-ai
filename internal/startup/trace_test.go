package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTraceOnlyAcceptsKnownFrontendStages(t *testing.T) {
	dir := t.TempDir()
	if err := Init(dir); err != nil {
		t.Fatal(err)
	}
	Stage("startup.database.open")()
	Frontend("frontend.first.interactive", 125)
	Frontend("secret note content", 5)
	Frontend("frontend.entry", -1)
	Close()
	raw, err := os.ReadFile(filepath.Join(dir, "startup.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "frontend.first.interactive 125.000ms") || strings.Contains(string(raw), "secret") {
		t.Fatal(string(raw))
	}
}
