package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/assetserver"
	assetoptions "github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"locknote-mcp/internal/api"
	"locknote-mcp/internal/mcp"
	"locknote-mcp/internal/store"
)

type nopLogger struct{}

func (nopLogger) Debug(string, ...interface{}) {}
func (nopLogger) Error(string, ...interface{}) {}

// 桌面窗口里，界面走 Wails 的资源服务、/api 走进程内 handler。
// 这里把这条链路单独跑一遍，确认两边都接得上。
func TestDesktopAssetChain(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/gui-test.db")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() { _ = st.Close() }()

	webFS, err := fs.Sub(webAssets, "frontend/dist")
	if err != nil {
		t.Fatalf("web assets: %v", err)
	}

	apiServer := api.New(api.Config{
		Store:   st,
		MCP:     mcp.NewServer(st, version, "http://127.0.0.1:7420"),
		WebFS:   webFS,
		Version: version,
		BaseURL: "http://127.0.0.1:7420",
	})

	handler, err := assetserver.NewAssetHandler(
		assetoptions.Options{Assets: webFS, Handler: apiServer.Handler()},
		nopLogger{},
	)
	if err != nil {
		t.Fatalf("asset handler: %v", err)
	}

	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	// 首页来自嵌入资源
	index := get("/")
	if index.Code != http.StatusOK {
		t.Fatalf("GET / => %d", index.Code)
	}
	if !strings.Contains(index.Body.String(), "LockNote.ai") {
		t.Error("首页应该是界面本身")
	}

	// 静态资源
	assets, err := fs.Glob(webFS, "assets/*")
	if err != nil || len(assets) == 0 {
		t.Fatalf("Vite assets missing: %v", err)
	}
	paths := []string{"/icon.svg"}
	for _, asset := range assets {
		paths = append(paths, "/"+asset)
	}
	for _, path := range paths {
		rec := get(path)
		if rec.Code != http.StatusOK || rec.Body.Len() == 0 {
			t.Errorf("GET %s => %d (%d bytes)", path, rec.Code, rec.Body.Len())
		}
	}

	// API 走 handler
	stats := get("/api/stats")
	if stats.Code != http.StatusOK {
		t.Fatalf("GET /api/stats => %d", stats.Code)
	}
	if !strings.Contains(stats.Body.String(), `"notes"`) {
		t.Errorf("API 返回不对: %s", stats.Body.String()[:80])
	}

	notes := get("/api/notes")
	if notes.Code != http.StatusOK || !strings.Contains(notes.Body.String(), "欢迎使用") {
		t.Errorf("GET /api/notes => %d", notes.Code)
	}
}
