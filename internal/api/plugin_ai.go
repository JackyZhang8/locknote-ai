package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Provider credentials stay in the request body and are never included in errors.
// This desktop-only route accepts chat payloads, not arbitrary HTTP forwarding.
func (s *Server) handlePluginAIChat(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	var input struct {
		BaseURL   string            `json:"baseURL"`
		APIKey    string            `json:"apiKey"`
		Model     string            `json:"model"`
		Messages  []json.RawMessage `json:"messages"`
		Tools     []json.RawMessage `json:"tools"`
		MaxTokens int               `json:"maxTokens"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, 400, "AI request is invalid or exceeds 2 MiB")
		return
	}
	endpoint, err := url.Parse(strings.TrimSpace(input.BaseURL))
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || (endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && isLoopbackProvider(endpoint.Hostname()))) {
		writeError(w, 400, "Provider URL must use HTTPS (HTTP is allowed for loopback providers only)")
		return
	}
	if strings.TrimSpace(input.Model) == "" || len(input.Model) > 200 || len(input.APIKey) > 8192 || strings.ContainsAny(input.APIKey, "\r\n") || len(input.Messages) == 0 || len(input.Messages) > 128 || len(input.Tools) > 16 || input.MaxTokens < 0 || input.MaxTokens > 32768 {
		writeError(w, 400, "Invalid AI model, credential, messages or tools")
		return
	}
	for _, message := range input.Messages {
		var value struct {
			Role string `json:"role"`
		}
		if json.Unmarshal(message, &value) != nil || (value.Role != "system" && value.Role != "user" && value.Role != "assistant" && value.Role != "tool") {
			writeError(w, 400, "Invalid AI message role")
			return
		}
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/chat/completions"
	endpoint.RawPath = ""
	payload := map[string]any{"model": input.Model, "messages": input.Messages, "stream": false}
	if input.MaxTokens > 0 {
		payload["max_tokens"] = input.MaxTokens
	}
	if len(input.Tools) > 0 {
		payload["tools"] = input.Tools
		payload["tool_choice"] = "auto"
	}
	raw, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(raw))
	if err != nil {
		writeError(w, 400, "Invalid provider request")
		return
	}
	request.Header.Set("Content-Type", "application/json")
	if input.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+input.APIKey)
	}
	client := &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		writeError(w, 502, "AI provider connection failed or timed out")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Provider error bodies can contain credentials or echo note text. Do not forward.
		message := "AI provider request failed"
		switch response.StatusCode {
		case 401, 403:
			message = "AI provider rejected the API key or account permissions"
		case 404:
			message = "AI provider endpoint or model was not found"
		case 429:
			message = "AI provider rate limit or quota exceeded"
		}
		writeError(w, 502, message)
		return
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (4<<20)+1))
	if err != nil || len(body) > 4<<20 || !json.Valid(body) {
		writeError(w, 502, "Invalid or oversized AI provider response")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(body)
}

func isLoopbackProvider(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Discovery returns model IDs only and shares the same desktop authorization.
func (s *Server) handlePluginAIModels(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var input struct {
		BaseURL string `json:"baseURL"`
		APIKey  string `json:"apiKey"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, 400, "Invalid provider configuration")
		return
	}
	endpoint, err := url.Parse(strings.TrimSpace(input.BaseURL))
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || (endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && isLoopbackProvider(endpoint.Hostname()))) || len(input.APIKey) > 8192 || strings.ContainsAny(input.APIKey, "\r\n") {
		writeError(w, 400, "Invalid provider URL or API key")
		return
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/models"
	endpoint.RawPath = ""
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		writeError(w, 400, "Invalid provider request")
		return
	}
	if input.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+input.APIKey)
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		writeError(w, 502, "Model discovery connection failed or timed out")
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		writeError(w, 502, "Model discovery failed: check URL, API key and provider support for /models")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		writeError(w, 502, "Model discovery response is too large")
		return
	}
	var data struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &data) != nil || data.Data == nil {
		writeError(w, 502, "Provider returned an invalid model list")
		return
	}
	models := make([]string, 0)
	seen := map[string]bool{}
	for _, item := range data.Data {
		id := strings.TrimSpace(item.ID)
		if id != "" && len(id) <= 200 && !seen[id] {
			seen[id] = true
			models = append(models, id)
		}
		if len(models) >= 1000 {
			break
		}
	}
	sort.Strings(models)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"models": models})
}
