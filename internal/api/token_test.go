package api

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotateGlobalTokenEndpoint(t *testing.T) {
	s := settingsServer(t)
	s.cfg.TokenFile = filepath.Join(t.TempDir(), "token")
	_, old, err := s.store.CreateToken("old")
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.handleRotateToken(rec, httptest.NewRequest("POST", "/api/token/rotate", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var response struct {
		Plaintext string `json:"plaintext"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(response.Plaintext, "locknote_") || !s.store.VerifyToken(response.Plaintext) || s.store.VerifyToken(old) {
		t.Fatal("invalid rotation result")
	}
}
