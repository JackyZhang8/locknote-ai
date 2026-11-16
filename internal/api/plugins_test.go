package api

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"locknote-mcp/internal/plugins"
	"locknote-mcp/internal/store"
)

func pluginAPI(t *testing.T) *Server {
	t.Helper()
	s := settingsServer(t)
	pm, err := plugins.New(t.TempDir(), "v0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Plugins = pm
	s.cfg.PluginSession = "desktop-secret"
	return s
}
func pluginRequest(s *Server, method, url, body, session string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	if session != "" {
		req.Header.Set("X-Locknote-Plugin-Session", session)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}
func pluginZIP(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range map[string]string{"manifest.json": `{"id":"example.outline","name":"Outline","version":"0.1.0","apiVersion":1,"minAppVersion":"0.1.0","entry":"main.js","capabilities":["notes.read","notes.write"]}`, "main.js": "export default {}"} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	zw.Close()
	return buf.Bytes()
}
func TestPluginManagementRequiresDesktopSession(t *testing.T) {
	s := pluginAPI(t)
	for _, session := range []string{"", "wrong"} {
		rec := pluginRequest(s, "GET", "/api/plugins", "", session)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("session %q got %d", session, rec.Code)
		}
	}
	s.cfg.RequireToken = true
	rec := pluginRequest(s, "GET", "/api/plugins", "", "desktop-secret")
	if rec.Code != 200 {
		t.Fatalf("desktop session must work independently of MCP token: %d %s", rec.Code, rec.Body.String())
	}
	rec = pluginRequest(s, "GET", "/api/stats", "", "desktop-secret")
	if rec.Code != http.StatusUnauthorized {
		t.Fatal("plugin session bypassed unrelated API authentication")
	}
}

func TestPluginTextEncodedZIPUpload(t *testing.T) {
	s := pluginAPI(t)
	for _, endpoint := range []string{"preview", "install"} {
		req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+endpoint, strings.NewReader(base64.StdEncoding.EncodeToString(pluginZIP(t))))
		req.Header.Set("X-Locknote-Plugin-Session", "desktop-secret")
		req.Header.Set("X-Locknote-Plugin-Encoding", "base64")
		req.Header.Set("Content-Type", "text/plain;charset=UTF-8")
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
			t.Fatalf("%s => %d %s", endpoint, rec.Code, rec.Body.String())
		}
	}
}

func TestPluginZIPTransportRejectsInvalidOrOversizedBodies(t *testing.T) {
	for _, tc := range []struct {
		name, encoding, body string
		status               int
	}{
		{"empty", "base64", "", http.StatusBadRequest},
		{"invalid encoding", "base64", "!invalid!", http.StatusBadRequest},
		{"unknown encoding", "other", "PK", http.StatusBadRequest},
		{"oversized raw", "", strings.Repeat("x", plugins.MaxPackageBytes+1), http.StatusRequestEntityTooLarge},
		{"oversized decoded", "base64", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0}, plugins.MaxPackageBytes+1)), http.StatusRequestEntityTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			req.Header.Set("X-Locknote-Plugin-Encoding", tc.encoding)
			rec := httptest.NewRecorder()
			if _, ok := readPluginZIP(rec, req); ok || rec.Code != tc.status {
				t.Fatalf("accepted=%v status=%d body=%s", ok, rec.Code, rec.Body.String())
			}
		})
	}
}
func TestPluginInstallAssetsAndUninstallAPI(t *testing.T) {
	s := pluginAPI(t)
	raw := string(pluginZIP(t))
	rec := pluginRequest(s, "POST", "/api/plugins/preview", raw, "desktop-secret")
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = pluginRequest(s, "POST", "/api/plugins/install", raw, "desktop-secret")
	if rec.Code != 201 {
		t.Fatal(rec.Body.String())
	}
	var record plugins.Record
	if err := json.Unmarshal(rec.Body.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record.Enabled {
		t.Fatal("install enabled plugin")
	}
	asset := "/api/plugins/assets/desktop-secret/example.outline/0.1.0/main.js"
	if rec = pluginRequest(s, "GET", asset, "", ""); rec.Code != 404 {
		t.Fatalf("disabled asset = %d", rec.Code)
	}
	rec = pluginRequest(s, "PUT", "/api/plugins/example.outline/enabled", `{"enabled":true}`, "desktop-secret")
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = pluginRequest(s, "GET", asset, "", "")
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("asset: %d %s", rec.Code, rec.Header())
	}
	rec = pluginRequest(s, "GET", strings.Replace(asset, "desktop-secret", "wrong", 1), "", "")
	if rec.Code != 403 {
		t.Fatal("asset session not checked")
	}
	rec = pluginRequest(s, "PUT", "/api/plugins/example.outline/data", `{"data":{"value":2}}`, "desktop-secret")
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = pluginRequest(s, "DELETE", "/api/plugins/example.outline?deleteData=1", "", "desktop-secret")
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
}
func TestPluginNoteWritesHaveSourceAndConflictChecks(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	rec := pluginRequest(s, "POST", "/api/plugins/example.outline/notes", `{"title":"Plugin note","content":"one"}`, "desktop-secret")
	if rec.Code != 201 {
		t.Fatal(rec.Body.String())
	}
	var note store.Note
	json.Unmarshal(rec.Body.Bytes(), &note)
	if note.Source != "plugin:example.outline" {
		t.Fatalf("source %q", note.Source)
	}
	url := "/api/plugins/example.outline/notes/" + note.ID
	rec = pluginRequest(s, "PATCH", url, `{"content":"two","expectedVersion":1}`, "desktop-secret")
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = pluginRequest(s, "PATCH", url, `{"content":"stale","expectedVersion":1}`, "desktop-secret")
	if rec.Code != 409 {
		t.Fatalf("stale update %d %s", rec.Code, rec.Body.String())
	}
	rec = pluginRequest(s, "PATCH", url, `{"content":"unchecked"}`, "desktop-secret")
	if rec.Code != 400 {
		t.Fatalf("unchecked update %d", rec.Code)
	}
}

func TestPluginsUnavailableWithoutConfiguredManager(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins = nil
	rec := pluginRequest(s, "GET", "/api/plugins", "", "desktop-secret")
	if rec.Code != 503 {
		t.Fatalf("unconfigured plugin manager = %d", rec.Code)
	}
	s.cfg.PluginSession = ""
	rec = pluginRequest(s, "GET", "/api/plugins", "", "")
	if rec.Code != 403 {
		t.Fatalf("empty session accepted: %d", rec.Code)
	}
}

func TestPluginReplacementRequiresReviewedInstalledDigest(t *testing.T) {
	s := pluginAPI(t)
	raw := pluginZIP(t)
	old, err := s.cfg.Plugins.Install(raw)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Plugins.SetEnabled(old.Manifest.ID, true)
	rec := pluginRequest(s, "POST", "/api/plugins/install", string(raw), "desktop-secret")
	if rec.Code != http.StatusConflict {
		t.Fatalf("unconfirmed replacement: %d %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest(http.MethodPost, "/api/plugins/install", bytes.NewReader(raw))
	req.Header.Set("X-Locknote-Plugin-Session", "desktop-secret")
	req.Header.Set("X-Locknote-Plugin-Expected-Digest", old.Digest)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated || !s.cfg.Plugins.List()[0].Enabled {
		t.Fatalf("identical confirmed package changed state: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPluginConfigurationRejectsStaleAdvancedEditor(t *testing.T) {
	s := pluginAPI(t)
	rec, err := s.cfg.Plugins.Install(pluginZIP(t))
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/plugins/" + rec.Manifest.ID + "/data"
	response := pluginRequest(s, "GET", endpoint, "", "desktop-secret")
	var initial struct{ Revision string }
	if err := json.Unmarshal(response.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	if initial.Revision == "" {
		t.Fatal("missing configuration revision")
	}
	if err := s.cfg.Plugins.PutData(rec.Manifest.ID, json.RawMessage(`{"maxLevel":2}`)); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"data": map[string]any{"maxLevel": 6}, "expectedRevision": initial.Revision})
	response = pluginRequest(s, "PUT", endpoint, string(body), "desktop-secret")
	if response.Code != http.StatusConflict {
		t.Fatalf("stale editor: %d %s", response.Code, response.Body.String())
	}
	data, _ := s.cfg.Plugins.Data(rec.Manifest.ID)
	if string(data) != `{"maxLevel":2}` {
		t.Fatalf("lost newer setting: %s", data)
	}
	response = pluginRequest(s, "GET", endpoint, "", "desktop-secret")
	json.Unmarshal(response.Body.Bytes(), &initial)
	body, _ = json.Marshal(map[string]any{"data": map[string]any{"maxLevel": 3}, "expectedRevision": initial.Revision})
	response = pluginRequest(s, "PUT", endpoint, string(body), "desktop-secret")
	if response.Code != http.StatusOK {
		t.Fatalf("fresh editor: %d %s", response.Code, response.Body.String())
	}
}

func TestNoteChangesReachDesktopAndSSEExactlyOnce(t *testing.T) {
	s := pluginAPI(t)
	events := []Event{}
	s.cfg.OnEvent = func(event Event) { events = append(events, event) }
	channel := s.Hub().subscribe()
	defer s.Hub().unsubscribe(channel)
	assertEvent := func(kind string) {
		t.Helper()
		if len(events) != 1 || events[0].Type != kind {
			t.Fatalf("desktop: %+v", events)
		}
		raw, _ := json.Marshal(events[0])
		var payload map[string]any
		json.Unmarshal(raw, &payload)
		if version, ok := payload["version"].(float64); !ok || version < 1 {
			t.Fatalf("missing persisted revision in event: %s", raw)
		}
		select {
		case event := <-channel:
			if event.Type != kind {
				t.Fatalf("SSE: %+v", event)
			}
		default:
			t.Fatal("no SSE event")
		}
		select {
		case event := <-channel:
			t.Fatalf("duplicate SSE: %+v", event)
		default:
		}
		events = nil
	}
	response := pluginRequest(s, "POST", "/api/notes", `{"title":"Browser edit","content":"Body"}`, "")
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	assertEvent("note.created")
	var note store.Note
	json.Unmarshal(response.Body.Bytes(), &note)
	response = pluginRequest(s, "PATCH", "/api/notes/"+note.ID, `{"content":"Changed"}`, "")
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	assertEvent("note.updated")
	s.Broadcast("note.updated", &note)
	assertEvent("note.updated")
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	response = pluginRequest(s, "POST", "/api/plugins/example.outline/notes", `{"title":"Plugin edit"}`, "desktop-secret")
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	assertEvent("note.created")
	if len(events) != 0 {
		t.Fatal("unexpected event")
	}
}

func TestPluginConflictsExposeStableCodes(t *testing.T) {
	for _, item := range []struct {
		err  error
		code string
	}{
		{plugins.ErrDataChanged, "CONFIG_CONFLICT"},
		{plugins.ErrInstallChanged, "INSTALL_CONFLICT"},
		{plugins.ErrConversationChanged, "CONVERSATION_CONFLICT"},
	} {
		response := httptest.NewRecorder()
		pluginError(response, item.err)
		var body struct{ Code string }
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusConflict || body.Code != item.code {
			t.Errorf("got %d %s; want %s", response.Code, response.Body.String(), item.code)
		}
	}
}
