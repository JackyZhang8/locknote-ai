package plugins

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func marketFixture(t *testing.T) (*Marketplace, *Manager, *[]byte, *[]byte, *bool) {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	manifest := `{"id":"dev.locknote.outline","name":"Outline","version":"0.1.1","apiVersion":1,"minAppVersion":"0.1.0","entry":"main.js","capabilities":["ui.sidebar","notes.readCurrent","editor.read"]}`
	for name, text := range map[string]string{"manifest.json": manifest, "main.js": "export default {}"} {
		file, e := writer.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = file.Write([]byte(text)); e != nil {
			t.Fatal(e)
		}
	}
	if e := writer.Close(); e != nil {
		t.Fatal(e)
	}
	raw := archive.Bytes()
	sum := sha256.Sum256(raw)
	pkg := raw
	offline := false
	release := MarketRelease{Version: "0.1.1", APIVersion: 1, MinAppVersion: "0.1.0", Capabilities: []string{"ui.sidebar", "notes.readCurrent", "editor.read"}, File: "dev.locknote.outline-0.1.1.zip", DownloadURL: "http://cdn.relaycat.cn/locknote_plus/dev.locknote.outline-0.1.1.zip", Size: int64(len(raw)), SHA256: hex.EncodeToString(sum[:])}
	catalog := MarketCatalog{SchemaVersion: 1, Plugins: []MarketPlugin{{ID: "dev.locknote.outline", Name: "Outline", LatestVersion: "0.1.1", Releases: []MarketRelease{release}}}}
	body, _ := json.Marshal(catalog)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if offline {
			http.Error(w, "offline", 503)
			return
		}
		if r.Header.Get("X-Locknote-Plugin-Session") != "" {
			t.Error("desktop credential leaked")
		}
		switch r.URL.Path {
		case "/locknote_plugins/plugins.json":
			w.Write(body)
		case "/locknote_plugins/" + release.File:
			w.Write(pkg)
		default:
			http.NotFound(w, r)
		}
	})
	manager, err := New(t.TempDir(), "v0.1.1")
	if err != nil {
		t.Fatal(err)
	}
	market := NewMarketplace(manager, "http://market.test/locknote_plugins/plugins.json")
	market.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if err := r.Context().Err(); err != nil {
			return nil, err
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, r)
		return rec.Result(), nil
	})
	return market, manager, &body, &pkg, &offline
}

func TestMarketDownloadBindsVerifiedPackageToApproval(t *testing.T) {
	market, manager, _, _, _ := marketFixture(t)
	catalog, err := market.Catalog(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	release := catalog.Catalog.Plugins[0].Releases[0]
	prepared, err := market.Prepare(context.Background(), "dev.locknote.outline", release.Version, release.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if len(manager.List()) != 0 || prepared.Preview.Manifest.ID != "dev.locknote.outline" {
		t.Fatal("preparation installed code or wrong manifest")
	}
	if _, err = market.Install(prepared.Token, "wrong-digest"); err == nil {
		t.Fatal("approval conflict accepted")
	}
	record, err := market.Install(prepared.Token, "")
	if err != nil {
		t.Fatal(err)
	}
	if record.Enabled {
		t.Fatal("implicitly enabled")
	}
	if _, err = market.Install(prepared.Token, ""); err == nil {
		t.Fatal("token reused")
	}
}
func TestMarketIntegrityAndMetadataFailuresNeverInstall(t *testing.T) {
	for _, kind := range []string{"sha", "size", "manifest", "changed", "path", "schema", "duplicate", "oversize"} {
		t.Run(kind, func(t *testing.T) {
			market, manager, body, pkg, _ := marketFixture(t)
			var c MarketCatalog
			json.Unmarshal(*body, &c)
			r := &c.Plugins[0].Releases[0]
			originalHash := r.SHA256
			switch kind {
			case "sha":
				*pkg = append([]byte(nil), (*pkg)...)
				(*pkg)[10] ^= 1
			case "size":
				r.Size++
			case "manifest":
				r.Capabilities = []string{"notes.write"}
			case "changed":
				originalHash = strings.Repeat("0", 64)
			case "path":
				r.File = "../outside.zip"
			case "schema":
				c.SchemaVersion = 2
			case "duplicate":
				c.Plugins = append(c.Plugins, c.Plugins[0])
			case "oversize":
				r.Size = MaxPackageBytes + 1
			}
			*body, _ = json.Marshal(c)
			prepared, err := market.Prepare(context.Background(), "dev.locknote.outline", r.Version, originalHash)
			if err == nil {
				market.Discard(prepared.Token)
				t.Fatal("invalid market content accepted")
			}
			if len(manager.List()) != 0 {
				t.Fatal("modified installed state")
			}
		})
	}
}
func TestMarketCachedCatalogSurvivesRestartAndOffline(t *testing.T) {
	market, manager, _, _, offline := marketFixture(t)
	if _, err := market.Catalog(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	*offline = true
	restarted := NewMarketplace(manager, market.catalogURL)
	restarted.client = market.client
	snapshot, err := restarted.Catalog(context.Background(), true)
	if err != nil || !snapshot.Stale || len(snapshot.Catalog.Plugins) != 1 || snapshot.Warning == "" {
		t.Fatalf("offline cache: %+v %v", snapshot, err)
	}
}
func TestMarketCancellationAndExpiry(t *testing.T) {
	market, _, _, _, _ := marketFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := market.Catalog(ctx, true); err == nil {
		t.Fatal("cancelled fetch accepted")
	}
	c, err := market.Catalog(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	r := c.Catalog.Plugins[0].Releases[0]
	p, err := market.Prepare(context.Background(), "dev.locknote.outline", r.Version, r.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	market.mu.Lock()
	item := market.prepared[p.Token]
	item.expires = time.Now().Add(-time.Second)
	market.prepared[p.Token] = item
	market.mu.Unlock()
	if _, err := market.Install(p.Token, ""); err == nil {
		t.Fatal("expired token accepted")
	}
	entries, _ := os.ReadDir(market.downloadDir)
	if len(entries) != 0 {
		t.Fatal("expired file leaked")
	}
}
func TestMarketRejectsRedirectOutsideCatalogDirectory(t *testing.T) {
	market, _, _, _, _ := marketFixture(t)
	market.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"http://example.com/file"}}, Body: http.NoBody, Request: r}, nil
	}), CheckRedirect: market.checkRedirect}
	if _, err := market.Catalog(context.Background(), true); err == nil {
		t.Fatal("external redirect followed")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMarketInstallRechecksPreparedFile(t *testing.T) {
	market, manager, _, _, _ := marketFixture(t)
	c, err := market.Catalog(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	r := c.Catalog.Plugins[0].Releases[0]
	p, err := market.Prepare(context.Background(), "dev.locknote.outline", r.Version, r.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	// A valid ZIP with the same manifest but changed code must not bypass the
	// exact package hash the user downloaded and reviewed.
	market.mu.Lock()
	path := market.prepared[p.Token].path
	market.mu.Unlock()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	original, _ := os.ReadFile(path)
	archive, _ := zip.NewReader(bytes.NewReader(original), int64(len(original)))
	for _, file := range archive.File {
		reader, _ := file.Open()
		data, _ := io.ReadAll(reader)
		reader.Close()
		if file.Name == "main.js" {
			data = []byte("export default { changed: true }")
		}
		out, _ := writer.Create(file.Name)
		out.Write(data)
	}
	writer.Close()
	if err = os.WriteFile(path, buf.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = market.Install(p.Token, ""); err == nil {
		t.Fatal("modified prepared file installed")
	}
	if len(manager.List()) != 0 {
		t.Fatal("installed corrupted download")
	}
}

func TestMarketPrereleaseCompatibility(t *testing.T) {
	for _, tc := range []struct {
		current, minimum string
		want             bool
	}{{"v0.1.1-alpha", "0.1.1", false}, {"v0.1.1", "0.1.1-beta", true}, {"0.1.1-beta.2", "0.1.1-beta.11", false}, {"0.1.1-beta.11", "0.1.1-beta.2", true}, {"0.2.0-alpha", "0.1.1", true}} {
		if got := marketCompatible(tc.current, tc.minimum); got != tc.want {
			t.Errorf("%s >= %s: got %v", tc.current, tc.minimum, got)
		}
	}
}

func TestMarketRedirectAllowsHTTPSUpgradeAndRejectsEscapingPaths(t *testing.T) {
	market, _, _, _, _ := marketFixture(t)
	for _, tc := range []struct {
		url     string
		allowed bool
	}{{"https://market.test/locknote_plugins/package.zip", true}, {"http://market.test/locknote_plugins/%2e%2e/private", false}, {"http://other.test/locknote_plugins/file.zip", false}, {"http://market.test/outside/file.zip", false}} {
		req, err := http.NewRequest("GET", tc.url, nil)
		if err != nil {
			t.Fatal(err)
		}
		if allowed := market.checkRedirect(req, nil) == nil; allowed != tc.allowed {
			t.Errorf("redirect %s allowed=%v", tc.url, allowed)
		}
	}
	market.catalogURL = "https://market.test/locknote_plugins/plugins.json"
	req, _ := http.NewRequest("GET", "http://market.test/locknote_plugins/file.zip", nil)
	if market.checkRedirect(req, nil) == nil {
		t.Fatal("HTTPS downgrade accepted")
	}
}

func TestMarketCancelledQueueReleasesDownloadSlot(t *testing.T) {
	market, _, body, _, _ := marketFixture(t)
	original := market.client.Transport
	started, release := make(chan struct{}), make(chan struct{})
	market.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { close(started); <-release; return original.RoundTrip(r) })
	refreshDone := make(chan error, 1)
	go func() { _, err := market.Catalog(context.Background(), true); refreshDone <- err }()
	<-started
	defer func() { close(release); <-refreshDone }()
	var catalog MarketCatalog
	json.Unmarshal(*body, &catalog)
	selected := catalog.Plugins[0].Releases[0]
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := market.Prepare(ctx, catalog.Plugins[0].ID, selected.Version, selected.SHA256)
		done <- err
	}()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("cancel result: %v", err)
		}
	case <-time.After(250 * time.Millisecond):
		t.Error("cancelled request still holds the download slot")
		return
	}
	if len(market.slots) != 0 {
		t.Error("download slot not released")
	}
}
func TestMarketRedirectCannotDowngradeAfterHTTPSUpgrade(t *testing.T) {
	market, _, _, _, _ := marketFixture(t)
	original, _ := http.NewRequest("GET", market.catalogURL, nil)
	secure, _ := http.NewRequest("GET", "https://market.test/locknote_plugins/plugins.json", nil)
	downgrade, _ := http.NewRequest("GET", market.catalogURL, nil)
	if market.checkRedirect(downgrade, []*http.Request{original, secure}) == nil {
		t.Fatal("HTTPS to HTTP downgrade accepted")
	}
}
func TestMarketExpiredCacheIsAvailableWithoutNetwork(t *testing.T) {
	market, manager, _, _, _ := marketFixture(t)
	snapshot, err := market.Catalog(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	snapshot.FetchedAt = time.Now().Add(-time.Hour)
	data, _ := json.Marshal(snapshot)
	if err = os.WriteFile(market.cacheFile, data, 0600); err != nil {
		t.Fatal(err)
	}
	restarted := NewMarketplace(manager, market.catalogURL)
	restarted.client.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("cache lookup attempted a network request")
		return nil, errors.New("offline")
	})
	cached, ok := restarted.CachedCatalog()
	if !ok || !cached.Revalidate || len(cached.Catalog.Plugins) != 1 {
		t.Fatalf("expired cache unavailable: %+v", cached)
	}
	if !cached.FetchedAt.Equal(snapshot.FetchedAt) {
		t.Fatal("cache timestamp changed without a successful refresh")
	}
}
