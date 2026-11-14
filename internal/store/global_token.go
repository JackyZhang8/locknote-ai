package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// EnsureGlobalToken preserves the current credential across restarts and
// migrates older multi-token installations to one locknote_ credential.
func (s *Store) EnsureGlobalToken(file string) (string, error) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	raw, err := os.ReadFile(file)
	token := strings.TrimSpace(string(raw))
	if err == nil && strings.HasPrefix(token, "locknote_") && s.VerifyToken(token) {
		if err := os.Chmod(file, 0600); err != nil {
			return "", err
		}
		_, err := s.db.Exec(`DELETE FROM api_tokens WHERE token_hash <> ?`, HashToken(token))
		return token, err
	}
	return s.rotateGlobalToken(file)
}

// RotateGlobalToken replaces both the private token file and all stored hashes.
func (s *Store) RotateGlobalToken(file string) (string, error) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	return s.rotateGlobalToken(file)
}

func (s *Store) rotateGlobalToken(file string) (string, error) {
	if file == "" {
		return "", fmt.Errorf("token file is not configured")
	}
	old, readErr := os.ReadFile(file)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", readErr
	}
	token, hash, prefix := NewToken()
	tmp, err := os.CreateTemp(filepath.Dir(file), ".token-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.WriteString(token + "\n"); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err = tmp.Close(); err != nil {
		return "", err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM api_tokens`); err != nil {
		return "", err
	}
	if _, err = tx.Exec(`INSERT INTO api_tokens (id,name,prefix,token_hash,created_at) VALUES (?,?,?,?,?)`, NewID("tok"), "全局 MCP 令牌", prefix, hash, nowString()); err != nil {
		return "", err
	}
	if err = os.Rename(tmp.Name(), file); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		if readErr == nil {
			_ = os.WriteFile(file, old, 0600)
		} else {
			_ = os.Remove(file)
		}
		return "", err
	}
	return token, nil
}
