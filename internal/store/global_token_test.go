package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGlobalTokenRotation(t *testing.T) {
	st := newTestStore(t)
	file := filepath.Join(t.TempDir(), "token")
	old, err := st.EnsureGlobalToken(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(old, "locknote_") {
		t.Fatal("wrong token prefix")
	}
	next, err := st.RotateGlobalToken(file)
	if err != nil {
		t.Fatal(err)
	}
	if next == old || st.VerifyToken(old) || !st.VerifyToken(next) {
		t.Fatal("rotation did not replace credential")
	}
	raw, err := os.ReadFile(file)
	if err != nil || strings.TrimSpace(string(raw)) != next {
		t.Fatal("token file not updated")
	}
	info, _ := os.Stat(file)
	if info.Mode().Perm() != 0600 {
		t.Fatal("token file must be private")
	}
	tokens, _ := st.ListTokens()
	if len(tokens) != 1 {
		t.Fatalf("got %d tokens", len(tokens))
	}
	again, err := st.EnsureGlobalToken(file)
	if err != nil || again != next {
		t.Fatal("restart changed token")
	}
	if _, err := st.RotateGlobalToken(filepath.Join(file, "missing")); err == nil {
		t.Fatal("expected file error")
	}
	if !st.VerifyToken(next) {
		t.Fatal("file error revoked working token")
	}
}

func TestGlobalTokenMigratesLegacy(t *testing.T) {
	st := newTestStore(t)
	file := filepath.Join(t.TempDir(), "token")
	old := "lnm_legacy"
	_, err := st.db.Exec(`INSERT INTO api_tokens (id,name,prefix,token_hash,created_at) VALUES ('old','legacy','lnm_',?,?)`, HashToken(old), nowString())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	next, err := st.EnsureGlobalToken(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(next, "locknote_") || st.VerifyToken(old) {
		t.Fatal("legacy token not migrated")
	}
}
