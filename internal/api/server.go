package api

import (
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"locknote-mcp/internal/mcp"
	"locknote-mcp/internal/plugins"
	"locknote-mcp/internal/store"
)

// Config wires the HTTP layer.
type Config struct {
	Store         *store.Store
	MCP           *mcp.Server
	WebFS         fs.FS
	Version       string
	BaseURL       string
	TokenFile     string
	Addr          string
	RequireToken  bool
	Logger        *log.Logger
	Plugins       *plugins.Manager
	PluginSession string
	OnEvent       func(Event)
}

// Server serves both the web UI and the JSON API.
type Server struct {
	cfg       Config
	store     *store.Store
	mcp       *mcp.Server
	hub       *Hub
	startedAt time.Time
}

// New creates the API server.
func New(cfg Config) *Server {
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stderr, "[api] ", log.LstdFlags)
	}
	return &Server{
		cfg:       cfg,
		store:     cfg.Store,
		mcp:       cfg.MCP,
		hub:       NewHub(),
		startedAt: time.Now(),
	}
}

// Hub fans out change notifications to connected browsers (SSE).
func (s *Server) Hub() *Hub { return s.hub }

// Broadcast pushes a note change to every open UI.
func (s *Server) Broadcast(kind string, note *store.Note) {
	if note == nil {
		return
	}
	s.publishEvent(Event{
		Type:      kind,
		NoteID:    note.ID,
		Title:     note.Title,
		Notebook:  note.NotebookName,
		Source:    note.Source,
		Version:   note.Version,
		UpdatedAt: note.UpdatedAt,
	})
}

// publishEvent keeps browser SSE and native desktop subscribers on one path.
func (s *Server) publishEvent(event Event) {
	s.hub.Publish(event)
	if s.cfg.OnEvent != nil {
		s.cfg.OnEvent(event)
	}
}

// Handler builds the full mux.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// --- notes -------------------------------------------------------------
	mux.HandleFunc("GET /api/notes", s.handleListNotes)
	mux.HandleFunc("POST /api/notes", s.handleCreateNote)
	mux.HandleFunc("POST /api/notes/{id}/discard-placeholder", s.handleDiscardPlaceholder)
	mux.HandleFunc("POST /api/notes/batch", s.handleBatchNotes)
	mux.HandleFunc("GET /api/notes/{id}", s.handleGetNote)
	mux.HandleFunc("PATCH /api/notes/{id}", s.handleUpdateNote)
	mux.HandleFunc("DELETE /api/notes/{id}", s.handleDeleteNote)
	mux.HandleFunc("POST /api/notes/{id}/restore", s.handleRestoreNote)
	mux.HandleFunc("GET /api/notes/{id}/revisions", s.handleListRevisions)
	mux.HandleFunc("GET /api/notes/{id}/revisions/{revID}", s.handleGetRevision)
	mux.HandleFunc("POST /api/notes/{id}/revisions/{revID}/restore", s.handleRestoreRevision)
	mux.HandleFunc("GET /api/notes/{id}/export", s.handleExportNote)

	// --- notebooks / tags --------------------------------------------------
	mux.HandleFunc("GET /api/notebooks", s.handleListNotebooks)
	mux.HandleFunc("POST /api/notebooks", s.handleCreateNotebook)
	mux.HandleFunc("PATCH /api/notebooks/{id}", s.handleUpdateNotebook)
	mux.HandleFunc("DELETE /api/notebooks/{id}", s.handleDeleteNotebook)
	mux.HandleFunc("GET /api/tags", s.handleListTags)
	mux.HandleFunc("POST /api/tags", s.handleCreateTag)
	mux.HandleFunc("PATCH /api/tags/{id}", s.handleUpdateTag)
	mux.HandleFunc("DELETE /api/tags/{id}", s.handleDeleteTag)

	// --- system ------------------------------------------------------------
	mux.HandleFunc("GET /api/system", s.handleSystem)
	mux.HandleFunc("GET /api/stats", s.handleStats)
	mux.HandleFunc("GET /api/activity", s.handleActivity)
	mux.HandleFunc("GET /api/events", s.handleEvents)
	mux.HandleFunc("POST /api/token/rotate", s.handleRotateToken)

	// --- preferences / data management ------------------------------------
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handlePutSettings)
	mux.HandleFunc("GET /api/export", s.handleExportAll)
	mux.HandleFunc("POST /api/import", s.handleImportMarkdown)
	mux.HandleFunc("POST /api/trash/empty", s.handleEmptyTrash)
	mux.HandleFunc("POST /api/trash/empty-stream", s.handleEmptyTrashStream)

	// --- desktop plugins ---------------------------------------------------
	mux.HandleFunc("GET /api/plugins", s.handlePlugins)
	mux.HandleFunc("POST /api/plugins/preview", s.handlePreviewPlugin)
	mux.HandleFunc("POST /api/plugins/install", s.handleInstallPlugin)
	mux.HandleFunc("POST /api/plugins/disable-all", s.handleDisablePlugins)
	mux.HandleFunc("PUT /api/plugins/{id}/enabled", s.handlePluginEnabled)
	mux.HandleFunc("DELETE /api/plugins/{id}", s.handleUninstallPlugin)
	mux.HandleFunc("GET /api/plugins/{id}/conversations", s.handlePluginConversations)
	mux.HandleFunc("POST /api/plugins/{id}/conversations", s.handlePluginConversations)
	mux.HandleFunc("PUT /api/plugins/{id}/conversations", s.handlePluginConversations)
	mux.HandleFunc("GET /api/plugins/{id}/conversations/{conversation}", s.handlePluginConversations)
	mux.HandleFunc("POST /api/plugins/{id}/conversations/{conversation}", s.handlePluginConversations)
	mux.HandleFunc("PATCH /api/plugins/{id}/conversations/{conversation}", s.handlePluginConversations)
	mux.HandleFunc("DELETE /api/plugins/{id}/conversations/{conversation}", s.handlePluginConversations)
	mux.HandleFunc("GET /api/plugins/{id}/data", s.handlePluginData)
	mux.HandleFunc("PUT /api/plugins/{id}/data", s.handlePluginData)
	mux.HandleFunc("GET /api/plugins/assets/{session}/{id}/{version}/{asset...}", s.handlePluginAsset)
	mux.HandleFunc("POST /api/plugins/{id}/ai/chat", s.handlePluginAIChat)
	mux.HandleFunc("POST /api/plugins/{id}/ai/models", s.handlePluginAIModels)
	mux.HandleFunc("GET /api/plugins/{id}/notes", s.handlePluginListNotes)
	mux.HandleFunc("GET /api/plugins/{id}/notes/{noteId}", s.handlePluginGetNote)
	mux.HandleFunc("POST /api/plugins/{id}/notes", s.handlePluginCreateNote)
	mux.HandleFunc("PATCH /api/plugins/{id}/notes/{noteId}", s.handlePluginUpdateNote)

	// --- MCP ---------------------------------------------------------------
	mux.Handle("/mcp", s.mcp.HTTPHandler(s.authorizeMCP))
	mux.Handle("/mcp/", s.mcp.HTTPHandler(s.authorizeMCP))

	// --- static UI ---------------------------------------------------------
	mux.Handle("/", s.staticHandler())

	return s.withMiddleware(mux)
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")

		isPluginRoute := r.URL.Path == "/api/plugins" || strings.HasPrefix(r.URL.Path, "/api/plugins/")
		if strings.HasPrefix(r.URL.Path, "/api/") && s.cfg.RequireToken && !isPluginRoute {
			if !s.authorizeMCP(r) {
				writeError(w, http.StatusUnauthorized, "需要访问令牌")
				return
			}
		}

		if p := r.URL.Path; p == "/" || strings.HasSuffix(p, ".html") ||
			strings.HasSuffix(p, ".css") || strings.HasSuffix(p, ".js") {
			// The UI is embedded in the binary and changes with every build;
			// never let the browser keep a stale copy.
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

// authorizeMCP validates a bearer token against the token table.
func (s *Server) authorizeMCP(r *http.Request) bool {
	token := mcp.BearerToken(r)
	if token == "" {
		return false
	}
	return s.store.VerifyToken(token)
}

func (s *Server) staticHandler() http.Handler {
	if s.cfg.WebFS == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "web assets not embedded", http.StatusInternalServerError)
		})
	}
	fileServer := http.FileServer(http.FS(s.cfg.WebFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		upath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if upath == "" {
			upath = "index.html"
		}
		if _, err := fs.Stat(s.cfg.WebFS, upath); err != nil {
			// Single page app: unknown paths fall back to index.html.
			if !strings.Contains(upath, ".") {
				r.URL.Path = "/"
				fileServer.ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

// LocalOnly reports whether the bind address is a loopback address.
func LocalOnly(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	switch host {
	case "", "127.0.0.1", "localhost", "::1", "[::1]":
		return true
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	defer func() { _, _ = io.Copy(io.Discard, r.Body) }()
	dec := json.NewDecoder(io.LimitReader(r.Body, 16<<20))
	dec.UseNumber()
	return dec.Decode(v)
}

// ---------------------------------------------------------------------------
// SSE hub
// ---------------------------------------------------------------------------

// Event is a UI refresh notification.
type Event struct {
	Type      string    `json:"type"`
	NoteID    string    `json:"noteId,omitempty"`
	Title     string    `json:"title,omitempty"`
	Notebook  string    `json:"notebook,omitempty"`
	Source    string    `json:"source,omitempty"`
	Version   int       `json:"version,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

// Hub is a tiny broadcast hub for SSE clients.
type Hub struct {
	mu      sync.Mutex
	clients map[chan Event]struct{}
}

// NewHub creates an empty hub.
func NewHub() *Hub { return &Hub{clients: map[chan Event]struct{}{}} }

// Publish sends an event to all subscribers without blocking.
func (h *Hub) Publish(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- e:
		default:
		}
	}
}

func (h *Hub) subscribe() chan Event {
	ch := make(chan Event, 16)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *Hub) unsubscribe(ch chan Event) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}
