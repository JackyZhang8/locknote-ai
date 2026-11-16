package main

import (
	"archive/zip"
	"locknote-mcp/internal/plugins"
	"os"
	"path/filepath"
	"testing"
)

func TestPackCreatesInstallableManifestAtRoot(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"dev.test","name":"Test","version":"0.1.0","apiVersion":1,"minAppVersion":"0.1.0","entry":"main.js","capabilities":[]}`
	for name, body := range map[string]string{"manifest.json": manifest, "main.js": "export default {activate(){}}"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	output, err := pack(dir, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.OpenReader(output)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.File) != 2 {
		t.Fatalf("files=%d", len(archive.File))
	}
	if filepath.Base(output) != "dev.test-0.1.0.zip" {
		t.Fatal(output)
	}
}
func TestPackRejectsSymlinks(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"dev.test","name":"Test","version":"0.1.0","apiVersion":1,"minAppVersion":"0.1.0","entry":"main.js","capabilities":[]}`), 0600)
	if err := os.Symlink("/etc/passwd", filepath.Join(dir, "main.js")); err != nil {
		t.Skip(err)
	}
	if _, err := pack(dir, t.TempDir()); err == nil {
		t.Fatal("symlink packaged")
	}
}

func TestRepositoryExamplesCanBeInstalledAndEnabled(t *testing.T) {
	for _, example := range []string{"outline", "note-checker"} {
		t.Run(example, func(t *testing.T) {
			archive, err := pack(filepath.Join("..", "..", "examples", "plugins", example), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(archive)
			if err != nil {
				t.Fatal(err)
			}
			manager, err := plugins.New(t.TempDir(), "v0.1.0")
			if err != nil {
				t.Fatal(err)
			}
			record, err := manager.Install(raw)
			if err != nil {
				t.Fatal(err)
			}
			if record.Enabled {
				t.Fatal("new example enabled without user action")
			}
			if _, err = manager.SetEnabled(record.Manifest.ID, true); err != nil {
				t.Fatal(err)
			}
			asset, err := manager.Asset(record.Manifest.ID, record.Manifest.Version, record.Manifest.Entry)
			if err != nil {
				t.Fatal(err)
			}
			_ = asset.Close()
			if example == "note-checker" {
				worker, err := manager.Asset(record.Manifest.ID, record.Manifest.Version, "assets/checker-worker.js")
				if err != nil {
					t.Fatal(err)
				}
				_ = worker.Close()
			}
			if _, err = manager.SetEnabled(record.Manifest.ID, false); err != nil {
				t.Fatal(err)
			}
			if err = manager.Uninstall(record.Manifest.ID, true); err != nil {
				t.Fatal(err)
			}
		})
	}
}
