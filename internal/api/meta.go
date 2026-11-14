package api

import (
	"errors"
	"net/http"

	"locknote-mcp/internal/store"
)

func (s *Server) handleListNotebooks(w http.ResponseWriter, r *http.Request) {
	nbs, err := s.store.ListNotebooks()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebooks": nbs})
}

func (s *Server) handleCreateNotebook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
		Icon        string `json:"icon"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	nb, created, err := s.store.CreateNotebook(req.Name, req.Icon, req.Color, req.Description)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !created {
		// No write happened, so neither the status nor the UI event should
		// claim that a notebook was created.
		writeJSON(w, http.StatusOK, nb)
		return
	}
	s.hub.Publish(Event{Type: "notebook.changed", Title: nb.Name})
	writeJSON(w, http.StatusCreated, nb)
}

func (s *Server) handleUpdateNotebook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		Color       *string `json:"color"`
		Icon        *string `json:"icon"`
		Pinned      *bool   `json:"pinned"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	nb, err := s.store.UpdateNotebook(r.PathValue("id"), req.Name, req.Icon, req.Color, req.Description, req.Pinned)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "笔记本不存在")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.hub.Publish(Event{Type: "notebook.changed", Title: nb.Name})
	writeJSON(w, http.StatusOK, nb)
}

func (s *Server) handleDeleteNotebook(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteNotebook(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, "笔记本不存在")
		return
	}
	s.hub.Publish(Event{Type: "notebook.changed"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := s.store.ListTags()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

func (s *Server) handleCreateTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	tag, err := s.store.CreateTag(req.Name, req.Color)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.hub.Publish(Event{Type: "tag.changed", Title: tag.Name})
	writeJSON(w, http.StatusCreated, tag)
}

func (s *Server) handleUpdateTag(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   *string `json:"name"`
		Color  *string `json:"color"`
		Pinned *bool   `json:"pinned"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	tag, err := s.store.UpdateTag(r.PathValue("id"), req.Name, req.Color, req.Pinned)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "标签不存在")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.hub.Publish(Event{Type: "tag.changed", Title: tag.Name})
	writeJSON(w, http.StatusOK, tag)
}

func (s *Server) handleDeleteTag(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteTag(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, "标签不存在")
		return
	}
	s.hub.Publish(Event{Type: "tag.changed"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
