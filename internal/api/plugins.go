package api

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"locknote-mcp/internal/plugins"
	"locknote-mcp/internal/store"
)

// Plugin management has a dedicated desktop-only credential. It is intentionally
// separate from the MCP bearer token and is never returned by public REST APIs.
func (s *Server) pluginSession(w http.ResponseWriter, r *http.Request, asset bool) bool {
	provided := r.Header.Get("X-Locknote-Plugin-Session")
	if asset {
		provided = r.PathValue("session")
	}
	if s.cfg.PluginSession == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.cfg.PluginSession)) != 1 {
		writeError(w, http.StatusForbidden, "插件功能仅限已授权的桌面会话")
		return false
	}
	if s.cfg.Plugins == nil {
		writeError(w, http.StatusServiceUnavailable, "插件管理尚未初始化")
		return false
	}
	return true
}
func pluginError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	code := "INVALID_ARGUMENT"
	switch {
	case errors.Is(err, plugins.ErrDataChanged):
		code = "CONFIG_CONFLICT"
	case errors.Is(err, plugins.ErrInstallChanged):
		code = "INSTALL_CONFLICT"
	case errors.Is(err, plugins.ErrConversationChanged):
		code = "CONVERSATION_CONFLICT"
	case errors.Is(err, plugins.ErrNotFound):
		code = "NOT_FOUND"
	}
	if errors.Is(err, plugins.ErrInstallChanged) || errors.Is(err, plugins.ErrDataChanged) || errors.Is(err, plugins.ErrConversationChanged) {
		status = http.StatusConflict
	}
	if errors.Is(err, plugins.ErrNotFound) {
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]any{"error": err.Error(), "code": code})
}
func readPluginZIP(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	encoding := r.Header.Get("X-Locknote-Plugin-Encoding")
	limit := int64(plugins.MaxPackageBytes)
	if encoding == "base64" {
		limit = int64(base64.StdEncoding.EncodedLen(plugins.MaxPackageBytes))
	} else if encoding != "" {
		writeError(w, http.StatusBadRequest, "不支持的插件传输编码")
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	var reader io.Reader = r.Body
	if encoding == "base64" {
		reader = base64.NewDecoder(base64.StdEncoding, r.Body)
	}
	raw, err := io.ReadAll(io.LimitReader(reader, plugins.MaxPackageBytes+1))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "插件 ZIP 不能超过 16 MiB")
		} else {
			writeError(w, http.StatusBadRequest, "插件安装包传输失败或编码无效，请重新选择 ZIP 文件")
		}
		return nil, false
	}
	if len(raw) > plugins.MaxPackageBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "插件 ZIP 不能超过 16 MiB")
		return nil, false
	}
	if len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "未收到插件安装包内容，请重新选择 ZIP 文件")
		return nil, false
	}
	return raw, true
}
func (s *Server) handlePlugins(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"plugins": s.cfg.Plugins.List(), "directory": s.cfg.Plugins.Directory()})
}
func (s *Server) handlePreviewPlugin(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	raw, ok := readPluginZIP(w, r)
	if !ok {
		return
	}
	preview, err := s.cfg.Plugins.Preview(raw)
	if err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preview)
}
func (s *Server) handleInstallPlugin(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	raw, ok := readPluginZIP(w, r)
	if !ok {
		return
	}
	rec, err := s.cfg.Plugins.InstallApproved(raw, r.Header.Get("X-Locknote-Plugin-Expected-Digest"))
	if err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}
func (s *Server) handlePluginEnabled(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "需要 enabled 布尔值")
		return
	}
	rec, err := s.cfg.Plugins.SetEnabled(r.PathValue("id"), *req.Enabled)
	if err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}
func (s *Server) handleUninstallPlugin(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	if err := s.cfg.Plugins.Uninstall(r.PathValue("id"), r.URL.Query().Get("deleteData") == "1"); err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
func (s *Server) handleDisablePlugins(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	if err := s.cfg.Plugins.DisableAll(); err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
func (s *Server) handlePluginData(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	id := r.PathValue("id")
	if r.Method == http.MethodPut {
		r.Body = http.MaxBytesReader(w, r.Body, plugins.MaxDataBytes+1024)
		var req struct {
			Data             json.RawMessage `json:"data"`
			ExpectedRevision *string         `json:"expectedRevision"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "插件配置格式无效或过大")
			return
		}
		if err := s.cfg.Plugins.PutDataIfRevision(id, req.Data, req.ExpectedRevision); err != nil {
			pluginError(w, err)
			return
		}
	}
	data, revision, err := s.cfg.Plugins.DataSnapshot(id)
	if err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "revision": revision})
}
func (s *Server) handlePluginAsset(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, true) {
		return
	}
	f, err := s.cfg.Plugins.Asset(r.PathValue("id"), r.PathValue("version"), r.PathValue("asset"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ext := strings.ToLower(filepath.Ext(stat.Name()))
	if ext == ".js" || ext == ".mjs" {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	} else if contentType := mime.TypeByExtension(ext); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.ServeContent(w, r, stat.Name(), stat.ModTime(), f)
}
func (s *Server) enabledPlugin(w http.ResponseWriter, r *http.Request) bool {
	if !s.pluginSession(w, r, false) {
		return false
	}
	for _, rec := range s.cfg.Plugins.List() {
		if rec.Manifest.ID == r.PathValue("id") {
			if rec.Enabled {
				return true
			}
			writeError(w, http.StatusForbidden, "插件尚未启用")
			return false
		}
	}
	writeError(w, http.StatusNotFound, "插件不存在")
	return false
}
func (s *Server) handlePluginListNotes(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	s.handleListNotes(w, r)
}
func (s *Server) handlePluginGetNote(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	id := r.PathValue("noteId")
	r.SetPathValue("id", id)
	s.handleGetNote(w, r)
}
func (s *Server) handlePluginCreateNote(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	var req createNoteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "笔记格式无效")
		return
	}
	pinned := req.Pinned
	note, err := s.store.CreateNote(store.NoteInput{Title: req.Title, Content: req.Content, Notebook: req.Notebook, NotebookID: req.NotebookID, Tags: req.Tags, Pinned: &pinned, Source: "plugin:" + r.PathValue("id")})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("note.created", note)
	writeJSON(w, http.StatusCreated, note)
}
func (s *Server) handlePluginUpdateNote(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	var patch store.NotePatch
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "笔记格式无效")
		return
	}
	if patch.ExpectedVersion == nil {
		writeError(w, http.StatusBadRequest, "插件更新必须提供 expectedVersion")
		return
	}
	patch.Source = "plugin:" + r.PathValue("id")
	patch.ForceRevision = true
	note, err := s.store.UpdateNote(r.PathValue("noteId"), patch)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, store.ErrNotFound) {
			status = http.StatusNotFound
		} else if errors.Is(err, store.ErrVersionConflict) {
			status = http.StatusConflict
		}
		writeError(w, status, err.Error())
		return
	}
	s.Broadcast("note.updated", note)
	writeJSON(w, http.StatusOK, note)
}
