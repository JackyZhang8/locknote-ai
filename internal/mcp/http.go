package mcp

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"locknote-mcp/internal/store"
)

// sessionStore keeps per-client handshake state for the HTTP transport.
type sessionStore struct {
	mu       sync.Mutex
	sessions map[string]*sessionState
}

type sessionState struct {
	info     *SessionInfo
	lastSeen time.Time
}

func newSessionStore() *sessionStore {
	return &sessionStore{sessions: map[string]*sessionState{}}
}

func (ss *sessionStore) create(transport string) *SessionInfo {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if len(ss.sessions) > 512 {
		for id, st := range ss.sessions {
			if time.Since(st.lastSeen) > 6*time.Hour {
				delete(ss.sessions, id)
			}
		}
	}
	info := &SessionInfo{ID: store.NewID("sess"), Transport: transport}
	ss.sessions[info.ID] = &sessionState{info: info, lastSeen: time.Now()}
	return info
}

func (ss *sessionStore) get(id string) *SessionInfo {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	st, ok := ss.sessions[id]
	if !ok {
		return nil
	}
	st.lastSeen = time.Now()
	return st.info
}

func (ss *sessionStore) remove(id string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	delete(ss.sessions, id)
}

// HTTPHandler returns the streamable-HTTP MCP endpoint.
//
// The handler accepts JSON-RPC over POST, answers with application/json (which
// the spec permits instead of an SSE stream), and keeps a session id so that
// clients which send Mcp-Session-Id reuse their negotiated protocol version.
func (s *Server) HTTPHandler(authorize func(*http.Request) bool) http.Handler {
	sessions := newSessionStore()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Mcp-Session-Id")
		w.Header().Set("Cache-Control", "no-store")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if authorize != nil && !authorize(r) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="locknote-mcp"`)
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"jsonrpc": "2.0",
				"id":      nil,
				"error":   map[string]any{"code": -32001, "message": "unauthorized: missing or invalid MCP token"},
			})
			return
		}

		switch r.Method {
		case http.MethodGet:
			// This server does not offer a standalone SSE stream; clients must
			// POST JSON-RPC messages.
			w.Header().Set("Allow", "POST, DELETE, OPTIONS")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
				"error": "this endpoint speaks streamable HTTP (POST only); connect with POST /mcp",
			})
			return
		case http.MethodDelete:
			if id := r.Header.Get("Mcp-Session-Id"); id != "" {
				sessions.remove(id)
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case http.MethodPost:
		default:
			w.Header().Set("Allow", "POST, DELETE, OPTIONS")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, rpcErrorPayload(CodeParseError, "read body: %v", err))
			return
		}
		body = trimSpaceBytes(body)
		if len(body) == 0 {
			writeJSON(w, http.StatusBadRequest, rpcErrorPayload(CodeParseError, "empty body"))
			return
		}

		sessID := r.Header.Get("Mcp-Session-Id")
		sess := sessions.get(sessID)
		if sess == nil {
			sess = sessions.create("http")
			w.Header().Set("Mcp-Session-Id", sess.ID)
		}

		if body[0] == '[' {
			var batch []Request
			if err := json.Unmarshal(body, &batch); err != nil {
				writeJSON(w, http.StatusBadRequest, rpcErrorPayload(CodeParseError, "invalid JSON: %v", err))
				return
			}
			out := make([]*Response, 0, len(batch))
			for i := range batch {
				if resp := s.Handle(r.Context(), &batch[i], sess); resp != nil {
					out = append(out, resp)
				}
			}
			if len(out) == 0 {
				w.WriteHeader(http.StatusAccepted)
				return
			}
			writeJSON(w, http.StatusOK, out)
			return
		}

		var req Request
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, rpcErrorPayload(CodeParseError, "invalid JSON: %v", err))
			return
		}
		resp := s.Handle(r.Context(), &req, sess)
		if resp == nil {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func rpcErrorPayload(code int, format string, args ...any) map[string]any {
	e := NewError(code, format, args...)
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      nil,
		"error":   map[string]any{"code": e.Code, "message": e.Message},
	}
}

func trimSpaceBytes(b []byte) []byte {
	i := 0
	for i < len(b) && (b[i] == ' ' || b[i] == '\n' || b[i] == '\r' || b[i] == '\t') {
		i++
	}
	j := len(b)
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\r' || b[j-1] == '\t') {
		j--
	}
	return b[i:j]
}

// BearerToken extracts a token from the Authorization header or ?token= query.
func BearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth != "" {
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			return strings.TrimSpace(auth[7:])
		}
		return strings.TrimSpace(auth)
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}
