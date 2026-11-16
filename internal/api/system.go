package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"locknote-mcp/internal/mcp"
)

func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request) {
	stats, _ := s.store.GetStats()

	defaultToken := ""
	if s.cfg.TokenFile != "" {
		if raw, err := os.ReadFile(s.cfg.TokenFile); err == nil {
			defaultToken = strings.TrimSpace(string(raw))
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"version":         s.cfg.Version,
		"protocolVersion": mcp.LatestVersion,
		"dbPath":          s.store.Path(),
		"baseUrl":         s.cfg.BaseURL,
		"mcpUrl":          strings.TrimRight(s.cfg.BaseURL, "/") + "/mcp",
		"startedAt":       s.startedAt,
		"requireToken":    s.cfg.RequireToken,
		"defaultToken":    defaultToken,
		"stats":           stats,
		"tools":           s.mcp.ToolsMeta(),
		"prompts":         s.mcp.PromptsMeta(),
		"resources":       s.mcp.ResourcesMeta(),
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.store.GetStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Activity(atoiDefault(r.URL.Query().Get("limit"), 30))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"activity": items})
}

// handleEvents streams server-sent events so the UI updates the moment an AI
// agent writes through MCP.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	fmt.Fprintf(w, "event: ready\ndata: {\"at\":%q}\n\n", time.Now().Format(time.RFC3339))
	flusher.Flush()

	ch := s.hub.subscribe()
	defer s.hub.unsubscribe(ch)

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			raw, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: change\ndata: %s\n\n", raw)
			flusher.Flush()
		}
	}
}

func (s *Server) handleRotateToken(w http.ResponseWriter, r *http.Request) {
	plaintext, err := s.store.RotateGlobalToken(s.cfg.TokenFile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更换令牌失败")
		return
	}
	s.publishEvent(Event{Type: "token.changed"})
	writeJSON(w, http.StatusOK, map[string]any{"plaintext": plaintext})
}
