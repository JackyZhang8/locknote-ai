package api

import (
	"encoding/json"
	"locknote-mcp/internal/plugins"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPluginMarketRoutesRequireDesktopSession(t *testing.T) {
	s := pluginAPI(t)
	for _, route := range []struct{ method, path string }{{"GET", "/api/plugins/market"}, {"POST", "/api/plugins/market/prepare"}, {"POST", "/api/plugins/market/install"}, {"DELETE", "/api/plugins/market/prepared/test"}} {
		for _, session := range []string{"", "wrong"} {
			r := pluginRequest(s, route.method, route.path, `{}`, session)
			if r.Code != http.StatusForbidden {
				t.Fatalf("%s %s => %d", route.method, route.path, r.Code)
			}
		}
	}
	for _, route := range []string{"prepare", "install"} {
		r := pluginRequest(s, "POST", "/api/plugins/market/"+route, `{}`, "desktop-secret")
		if r.Code != 400 {
			t.Fatalf("empty %s request: %d %s", route, r.Code, r.Body.String())
		}
	}
	r := pluginRequest(s, "DELETE", "/api/plugins/market/prepared/test", "", "desktop-secret")
	if r.Code != 200 || !strings.Contains(r.Body.String(), "true") {
		t.Fatalf("discard: %d %s", r.Code, r.Body.String())
	}
}

func TestPluginMarketCachedEndpointReturnsExpiredCatalogImmediately(t *testing.T) {
	s := pluginAPI(t)
	root := filepath.Join(s.cfg.Plugins.Directory(), "_market")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	cached := plugins.MarketSnapshot{Catalog: plugins.MarketCatalog{SchemaVersion: 1, Plugins: []plugins.MarketPlugin{}}, FetchedAt: time.Now().Add(-time.Hour)}
	data, _ := json.Marshal(cached)
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	response := pluginRequest(s, "GET", "/api/plugins/market?cached=1", "", "desktop-secret")
	if response.Code != 200 {
		t.Fatalf("cached endpoint: %d %s", response.Code, response.Body.String())
	}
	var result plugins.MarketSnapshot
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Revalidate || result.Stale || !result.FetchedAt.Equal(cached.FetchedAt) {
		t.Fatalf("cached snapshot: %+v", result)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("cached API response is browser-cacheable")
	}
}
