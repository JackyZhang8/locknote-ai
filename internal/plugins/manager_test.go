package plugins

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func packageZIP(t *testing.T, manifest Manifest, extra map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	raw, _ := json.Marshal(manifest)
	files := map[string]string{"manifest.json": string(raw), "main.js": "export default {activate() {}}"}
	for name, body := range extra {
		files[name] = body
	}
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func sampleManifest() Manifest {
	return Manifest{ID: "example.outline", Name: "Outline", Version: "0.1.0", APIVersion: 1, MinAppVersion: "0.1.0", Entry: "main.js", Capabilities: []string{"ui.sidebar"}}
}

func TestInstallLifecycleAndDataSurviveRestart(t *testing.T) {
	root := t.TempDir()
	m, err := New(root, "v0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := m.Install(packageZIP(t, sampleManifest(), nil))
	if err != nil {
		t.Fatal(err)
	}
	if rec.Enabled {
		t.Fatal("installation must never execute a plugin automatically")
	}
	if _, err = m.Asset(rec.Manifest.ID, rec.Manifest.Version, "main.js"); err == nil {
		t.Fatal("disabled assets accessible")
	}
	if _, err = m.SetEnabled(rec.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	f, err := m.Asset(rec.Manifest.ID, rec.Manifest.Version, "main.js")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err = m.PutData(rec.Manifest.ID, json.RawMessage(`{"option":"kept"}`)); err != nil {
		t.Fatal(err)
	}
	m, err = New(root, "v0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if len(m.List()) != 1 || !m.List()[0].Enabled {
		t.Fatal("enabled state lost")
	}
	if err = m.Uninstall(rec.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Install(packageZIP(t, sampleManifest(), nil)); err != nil {
		t.Fatal(err)
	}
	data, err := m.Data(rec.Manifest.ID)
	if err != nil || string(data) != `{"option":"kept"}` {
		t.Fatalf("preserved config = %s, %v", data, err)
	}
	if err = m.Uninstall(rec.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "_data", rec.Manifest.ID+".json")); !os.IsNotExist(err) {
		t.Fatalf("config remains: %v", err)
	}
}

func TestRejectUnsafeAndIncompatibleZIPWithoutReplacingInstalledVersion(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	if _, err := m.Install(packageZIP(t, sampleManifest(), nil)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../escape.js", "/absolute.js", `folder\evil.js`, "C:/evil.js"} {
		if _, err := m.Install(packageZIP(t, sampleManifest(), map[string]string{name: "bad"})); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	newer := sampleManifest()
	newer.MinAppVersion = "2.0.0"
	if _, err := m.Install(packageZIP(t, newer, nil)); err == nil {
		t.Fatal("accepted incompatible plugin")
	}
	if got := m.List(); len(got) != 1 || got[0].Manifest.Version != "0.1.0" {
		t.Fatalf("existing install changed: %v", got)
	}
	if _, err := m.Asset("example.outline", "0.1.0", "../_state.json"); err == nil {
		t.Fatal("traversal asset accepted")
	}
}

func TestUpdateDisablesPluginAndDisableAllPersists(t *testing.T) {
	root := t.TempDir()
	m, _ := New(root, "v0.1.0")
	man := sampleManifest()
	m.Install(packageZIP(t, man, nil))
	m.SetEnabled(man.ID, true)
	man.Version = "0.2.0"
	rec, err := m.Install(packageZIP(t, man, nil))
	if err != nil {
		t.Fatal(err)
	}
	if rec.Enabled {
		t.Fatal("updates must require enabling again")
	}
	m.SetEnabled(man.ID, true)
	if err := m.DisableAll(); err != nil {
		t.Fatal(err)
	}
	restored, err := New(root, "v0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if restored.List()[0].Enabled {
		t.Fatal("disable all was not persisted")
	}
}

func TestRejectSymlinksAndLargeArchives(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	if _, err := m.Preview(make([]byte, MaxPackageBytes+1)); err == nil {
		t.Fatal("oversized ZIP accepted")
	}
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	h := &zip.FileHeader{Name: "linked.js", Method: zip.Store}
	h.SetMode(os.ModeSymlink | 0777)
	w, _ := zw.CreateHeader(h)
	w.Write([]byte("../outside"))
	zw.Close()
	if _, err := m.Preview(b.Bytes()); err == nil {
		t.Fatal("symlink accepted")
	}
	many := map[string]string{}
	for i := 0; i < MaxFiles; i++ {
		many[fmt.Sprintf("asset-%d.txt", i)] = ""
	}
	if _, err := m.Preview(packageZIP(t, sampleManifest(), many)); err == nil {
		t.Fatal("file count limit not applied")
	}
}

func TestRejectConflictingSameVersionAndPreserveOriginal(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	raw := packageZIP(t, sampleManifest(), nil)
	if _, err := m.Install(raw); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Install(packageZIP(t, sampleManifest(), map[string]string{"main.js": "unapproved replacement"})); err == nil {
		t.Fatal("replaced immutable version")
	}
	if _, err := m.SetEnabled("example.outline", true); err != nil {
		t.Fatal(err)
	}
	f, err := m.Asset("example.outline", "0.1.0", "main.js")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	body, _ := io.ReadAll(f)
	if strings.Contains(string(body), "unapproved") {
		t.Fatal("original package changed")
	}
}

func TestMinimumVersionUsesSemverPrereleaseOrdering(t *testing.T) {
	tests := []struct {
		current, minimum string
		want             bool
	}{
		{"v0.10.0", "0.9.0", true}, {"v0.1.0-alpha", "0.1.0-beta", false},
		{"v0.1.0-beta.2", "0.1.0-beta.11", false}, {"v0.1.0", "0.1.0-beta", true},
		{"v0.1.0-alpha", "0.1.0", false},
	}
	for _, tt := range tests {
		if got := compatible(tt.current, tt.minimum); got != tt.want {
			t.Errorf("compatible(%q,%q)=%v", tt.current, tt.minimum, got)
		}
	}
}

func TestZIPSupportsOneTopDirectoryAndPreviewDoesNotInstall(t *testing.T) {
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	man, _ := json.Marshal(sampleManifest())
	for name, body := range map[string]string{"outline/manifest.json": string(man), "outline/main.js": "export default {}"} {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	zw.Close()
	m, _ := New(t.TempDir(), "v0.1.0")
	preview, err := m.Preview(b.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if preview.Manifest.ID != "example.outline" || len(m.List()) != 0 {
		t.Fatal("preview mutated installed state")
	}
	if _, err = m.Install(b.Bytes()); err != nil {
		t.Fatal(err)
	}
}

func TestRejectExpandedArchiveAndOversizedConfiguration(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	oversized := packageZIP(t, sampleManifest(), map[string]string{"assets/bomb.txt": strings.Repeat("a", MaxExpandedBytes+1)})
	if _, err := m.Preview(oversized); err == nil {
		t.Fatal("expanded ZIP limit not applied")
	}
	if _, err := m.Install(packageZIP(t, sampleManifest(), nil)); err != nil {
		t.Fatal(err)
	}
	data := json.RawMessage(`{"large":"` + strings.Repeat("x", MaxDataBytes) + `"}`)
	if err := m.PutData("example.outline", data); err == nil {
		t.Fatal("oversized configuration accepted")
	}
	for _, raw := range []string{"null", "[]", `"string"`} {
		if err := m.PutData("example.outline", json.RawMessage(raw)); err == nil {
			t.Errorf("accepted data %s", raw)
		}
	}
}

func TestRejectNonPortableArchivePaths(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	for _, name := range []string{
		"MAIN.JS", "assets/item.", "assets/item ", "assets/CON", "assets/con.txt",
		"PRN.json", "aux.css", "NUL.js", "assets/COM1.png", "assets/com9.txt", "LPT1.txt", "lpt9",
		"folder./file.js", "folder /file.js", "assets/a:b.txt", "assets/control\x01.txt",
		"assets/line\n.txt", "assets/control\x7f.txt", "assets/invalid\xff.txt", "assets/a?.txt",
	} {
		t.Run(fmt.Sprintf("%q", name), func(t *testing.T) {
			if _, err := m.Preview(packageZIP(t, sampleManifest(), map[string]string{name: "bad"})); err == nil {
				t.Errorf("non-portable path accepted: %q", name)
			}
		})
	}
}

func TestPortableArchiveAllowsUnicodeAndOrdinaryReservedPrefixes(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	files := map[string]string{"assets/中文说明.txt": "说明", "assets/console.js": "", "assets/COM10.txt": "", "assets/lpt0.txt": "", "assets/a b.txt": ""}
	if _, err := m.Preview(packageZIP(t, sampleManifest(), files)); err != nil {
		t.Fatal(err)
	}
}

func TestRejectCaseInsensitiveDuplicateDirectories(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	man, _ := json.Marshal(sampleManifest())
	for _, f := range []struct{ name, body string }{{"manifest.json", string(man)}, {"main.js", "export default {}"}, {"assets/", ""}, {"ASSETS/", ""}} {
		w, _ := zw.Create(f.name)
		w.Write([]byte(f.body))
	}
	zw.Close()
	if _, err := m.Preview(b.Bytes()); err == nil {
		t.Fatal("case-insensitive duplicate directories accepted")
	}
}
