package plugins

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"testing"
)

func TestPreviewClassifiesInstallDecisions(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	raw := packageZIP(t, sampleManifest(), nil)
	p, err := m.Preview(raw)
	if err != nil || p.Action != "install" {
		t.Fatalf("new: %+v %v", p, err)
	}
	original, err := m.Install(raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ version, action string }{
		{"0.2.0", "upgrade"}, {"0.0.9", "downgrade"}, {"0.1.0-beta.1", "downgrade"}, {"0.1.0", "replace"},
	} {
		man := sampleManifest()
		man.Version = tc.version
		p, err := m.Preview(packageZIP(t, man, map[string]string{"main.js": "changed"}))
		if err != nil || p.Action != tc.action || p.Replaces == nil || p.Replaces.Digest != original.Digest {
			t.Fatalf("%s: %+v %v", tc.version, p, err)
		}
	}
	p, err = m.Preview(raw)
	if err != nil || p.Action != "identical" {
		t.Fatalf("identical: %+v %v", p, err)
	}
	man := sampleManifest()
	man.ID = "example.other"
	man.Name = " outline "
	p, err = m.Preview(packageZIP(t, man, nil))
	if err != nil || p.Action != "install" || p.Replaces != nil || len(p.SameName) != 1 {
		t.Fatalf("name collision: %+v %v", p, err)
	}
}

func TestApprovedReplacementPreservesDataAndRejectsStaleApproval(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	raw := packageZIP(t, sampleManifest(), nil)
	old, _ := m.Install(raw)
	m.SetEnabled(old.Manifest.ID, true)
	m.PutData(old.Manifest.ID, json.RawMessage(`{"keep":true}`))
	changed := packageZIP(t, sampleManifest(), map[string]string{"main.js": "replacement"})
	if _, err := m.InstallApproved(changed, ""); !errors.Is(err, ErrInstallChanged) {
		t.Fatalf("missing approval: %v", err)
	}
	if !m.List()[0].Enabled {
		t.Fatal("failed replacement disabled existing plugin")
	}
	next, err := m.InstallApproved(changed, old.Digest)
	if err != nil || next.Enabled || next.Digest == old.Digest {
		t.Fatalf("replacement: %+v %v", next, err)
	}
	if _, err := m.InstallApproved(raw, old.Digest); !errors.Is(err, ErrInstallChanged) {
		t.Fatalf("stale approval: %v", err)
	}
	data, _ := m.Data(old.Manifest.ID)
	if string(data) != `{"keep":true}` {
		t.Fatalf("lost configuration: %s", data)
	}
	m.SetEnabled(next.Manifest.ID, true)
	unchanged, err := m.InstallApproved(changed, next.Digest)
	if err != nil || !unchanged.Enabled {
		t.Fatalf("identical package changed state: %+v %v", unchanged, err)
	}
	f, err := m.Asset(next.Manifest.ID, next.Manifest.Version+"@"+next.Digest, "main.js")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	if _, err := m.Asset(next.Manifest.ID, next.Manifest.Version+"@"+old.Digest, "main.js"); err == nil {
		t.Fatal("stale module URL returned replaced code")
	}
}

func TestPackageIdentityIgnoresZIPContainerMetadata(t *testing.T) {
	m, _ := New(t.TempDir(), "v0.1.0")
	raw := packageZIP(t, sampleManifest(), nil)
	original, _ := m.Install(raw)
	source, _ := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	var repacked bytes.Buffer
	writer := zip.NewWriter(&repacked)
	writer.SetComment("Different ZIP metadata, identical plugin files")
	for i := len(source.File) - 1; i >= 0; i-- {
		file := source.File[i]
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		entry, err := writer.Create(file.Name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	p, err := m.Preview(repacked.Bytes())
	if err != nil || p.Action != "identical" || p.Digest != original.Digest {
		t.Fatalf("repacked identical files: %+v %v", p, err)
	}
}

func TestManifestTranslationsPersistAndAreCloned(t *testing.T) {
	root := t.TempDir()
	m, _ := New(root, "v0.1.0")
	man := sampleManifest()
	man.DefaultLocale = "en"
	man.Locales = map[string]map[string]string{"en": {"name": "Outline"}, "zh": {"name": "大纲"}}
	if _, err := m.Install(packageZIP(t, man, nil)); err != nil {
		t.Fatal(err)
	}
	list := m.List()
	list[0].Manifest.Locales["zh"]["name"] = "mutated"
	if m.List()[0].Manifest.Locales["zh"]["name"] != "大纲" {
		t.Fatal("dictionary leaked mutable manager state")
	}
	restored, err := New(root, "v0.1.0")
	if err != nil || restored.List()[0].Manifest.Locales["en"]["name"] != "Outline" {
		t.Fatalf("lost translations: %v", err)
	}
}
