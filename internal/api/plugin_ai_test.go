package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type aiTestTransport func(*http.Request) (*http.Response, error)

func (f aiTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func setAITransport(t *testing.T, f aiTestTransport) {
	t.Helper()
	old := http.DefaultTransport
	http.DefaultTransport = f
	t.Cleanup(func() { http.DefaultTransport = old })
}
func aiRequestBody(base string) string {
	raw, _ := json.Marshal(map[string]any{"baseURL": base, "apiKey": "test-secret", "model": "deepseek-flash", "messages": []map[string]string{{"role": "user", "content": "Hi"}}})
	return string(raw)
}

func TestPluginAIChatTransport(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	calls := 0
	setAITransport(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://provider.example/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Errorf("invalid upstream request")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "deepseek-flash" || body["stream"] != false {
			t.Errorf("invalid chat payload: %v", body)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"role":"assistant","content":"Hello"}}]}`))}, nil
	})
	raw := aiRequestBody("https://provider.example/v1/")
	url := "/api/plugins/example.outline/ai/chat"
	if rec := pluginRequest(s, "POST", url, raw, ""); rec.Code != 403 {
		t.Fatalf("unauthenticated %d", rec.Code)
	}
	rec := pluginRequest(s, "POST", url, raw, "desktop-secret")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Hello") {
		t.Fatalf("chat: %d %s", rec.Code, rec.Body.String())
	}
	s.cfg.Plugins.SetEnabled("example.outline", false)
	if rec = pluginRequest(s, "POST", url, raw, "desktop-secret"); rec.Code != 403 {
		t.Fatalf("disabled %d", rec.Code)
	}
	if calls != 1 {
		t.Fatalf("upstream calls: %d", calls)
	}
}

func TestPluginAIRejectsUnsafeProviderAndRedirects(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	for _, base := range []string{"http://example.com", "file:///tmp/key", "https://user:pass@example.com", "https://example.com?q=secret", "https://example.com/#x"} {
		rec := pluginRequest(s, "POST", "/api/plugins/example.outline/ai/chat", aiRequestBody(base), "desktop-secret")
		if rec.Code != 400 {
			t.Errorf("accepted %q: %d", base, rec.Code)
		}
	}
	calls := 0
	setAITransport(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 307, Header: http.Header{"Location": []string{"https://redirect.example/"}}, Body: io.NopCloser(strings.NewReader("test-secret"))}, nil
	})
	rec := pluginRequest(s, "POST", "/api/plugins/example.outline/ai/chat", aiRequestBody("https://provider.example"), "desktop-secret")
	if rec.Code != 502 || calls != 1 || strings.Contains(rec.Body.String(), "test-secret") {
		t.Fatalf("redirect result %d calls %d", rec.Code, calls)
	}
}

func TestPluginAIProviderErrorsAreBoundedAndRedacted(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	for _, tc := range []struct {
		status int
		body   string
	}{
		{401, "test-secret"}, {429, "note body test-secret"}, {200, "invalid json test-secret"}, {200, strings.Repeat(" ", 4<<20) + "{}"},
	} {
		t.Run(http.StatusText(tc.status)+string(rune(len(tc.body)%100+65)), func(t *testing.T) {
			setAITransport(t, func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			rec := pluginRequest(s, "POST", "/api/plugins/example.outline/ai/chat", aiRequestBody("https://provider.example"), "desktop-secret")
			if rec.Code != 502 || strings.Contains(rec.Body.String(), "test-secret") {
				t.Fatalf("invalid failure %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestPluginAIModelsDiscovery(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	calls := 0
	setAITransport(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "GET" || r.URL.String() != "https://provider.example/v1/models" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Errorf("invalid discovery request")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"data":[{"id":"z-model"},{"id":"deepseek-flash"},{"id":"deepseek-flash"},{"id":""}]}`))}, nil
	})
	path := "/api/plugins/example.outline/ai/models"
	raw := `{"baseURL":"https://provider.example/v1/","apiKey":"test-secret"}`
	if rec := pluginRequest(s, "POST", path, raw, ""); rec.Code != 403 {
		t.Fatalf("unauthorized %d", rec.Code)
	}
	rec := pluginRequest(s, "POST", path, raw, "desktop-secret")
	if rec.Code != 200 {
		t.Fatalf("models %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Models []string `json:"models"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Models) != 2 || body.Models[0] != "deepseek-flash" {
		t.Fatalf("models %+v", body)
	}
	s.cfg.Plugins.SetEnabled("example.outline", false)
	if rec = pluginRequest(s, "POST", path, raw, "desktop-secret"); rec.Code != 403 || calls != 1 {
		t.Fatalf("disabled %d calls %d", rec.Code, calls)
	}
}

func TestPluginAIOutputLimitAndDiscoveryErrors(t *testing.T) {
	s := pluginAPI(t)
	s.cfg.Plugins.Install(pluginZIP(t))
	s.cfg.Plugins.SetEnabled("example.outline", true)
	setAITransport(t, func(r *http.Request) (*http.Response, error) {
		if r.Method == "GET" {
			return &http.Response{StatusCode: 401, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("test-secret"))}, nil
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["max_tokens"] != float64(16) {
			t.Errorf("missing test output limit")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"role":"assistant","content":"OK"}}]}`))}, nil
	})
	raw := strings.TrimSuffix(aiRequestBody("https://provider.example"), "}") + `,"maxTokens":16}`
	rec := pluginRequest(s, "POST", "/api/plugins/example.outline/ai/chat", raw, "desktop-secret")
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = pluginRequest(s, "POST", "/api/plugins/example.outline/ai/models", aiRequestBody("https://provider.example"), "desktop-secret")
	if rec.Code != 502 || strings.Contains(rec.Body.String(), "test-secret") {
		t.Fatalf("discovery error %d %s", rec.Code, rec.Body.String())
	}
}
