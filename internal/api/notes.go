package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"locknote-mcp/internal/store"
	"locknote-mcp/internal/textutil"
)

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.ListFilter{
		Scope:    q.Get("scope"),
		Tag:      q.Get("tag"),
		Query:    q.Get("q"),
		Sort:     q.Get("sort"),
		Limit:    atoiDefault(q.Get("limit"), 200),
		Offset:   atoiDefault(q.Get("offset"), 0),
		WithBody: q.Get("withBody") == "1",
	}
	if nb := strings.TrimSpace(q.Get("notebook")); nb != "" {
		f.Scope = "notebook"
		if strings.HasPrefix(nb, "nb_") {
			f.NotebookID = nb
		} else if found, err := s.store.GetNotebookByName(nb); err == nil {
			f.NotebookID = found.ID
		} else {
			writeJSON(w, http.StatusOK, map[string]any{"notes": []any{}, "total": 0, "scope": "notebook"})
			return
		}
	}
	if f.Scope == "" {
		f.Scope = "all"
	}

	notes, total, err := s.store.ListNotes(f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notes":  notes,
		"total":  total,
		"scope":  f.Scope,
		"offset": f.Offset,
	})
}

func (s *Server) handleGetNote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	note, err := s.store.GetNote(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "笔记不存在")
		return
	}
	writeJSON(w, http.StatusOK, note)
}

type createNoteRequest struct {
	Title      string   `json:"title"`
	Content    string   `json:"content"`
	Notebook   string   `json:"notebook"`
	NotebookID string   `json:"notebookId"`
	Tags       []string `json:"tags"`
	Pinned     bool     `json:"pinned"`
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
	var req createNoteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	pinned := req.Pinned
	note, err := s.store.CreateNote(store.NoteInput{
		Title:      req.Title,
		Content:    req.Content,
		Notebook:   req.Notebook,
		NotebookID: req.NotebookID,
		Tags:       req.Tags,
		Pinned:     &pinned,
		Source:     "web",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("note.created", note)
	writeJSON(w, http.StatusCreated, note)
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var patch store.NotePatch
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	patch.Source = "web"
	if r.URL.Query().Get("checkpoint") == "true" {
		patch.ForceRevision = true
	}
	note, err := s.store.UpdateNote(id, patch)
	if err != nil {
		if errors.Is(err, store.ErrVersionConflict) {
			writeError(w, http.StatusConflict, "笔记已变化，请重新对比后操作")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "笔记不存在")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("note.updated", note)
	writeJSON(w, http.StatusOK, note)
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	note, err := s.store.GetNote(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "笔记不存在")
		return
	}
	if r.URL.Query().Get("hard") == "1" {
		if err := s.store.HardDelete(id); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.Broadcast("note.deleted", note)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "hard": true})
		return
	}
	if err := s.store.SoftDelete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("note.deleted", note)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleRestoreNote(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.Restore(id); err != nil {
		writeError(w, http.StatusNotFound, "回收站里没有这篇笔记")
		return
	}
	note, err := s.store.GetNote(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("note.updated", note)
	writeJSON(w, http.StatusOK, note)
}

func (s *Server) handleBatchNotes(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs        []string `json:"ids"`
		Action     string   `json:"action"`
		NotebookID string   `json:"notebookId"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "请先选择笔记")
		return
	}
	done, err := s.store.BatchAction(req.IDs, req.Action, req.NotebookID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.publishEvent(Event{Type: "notes.batch", Title: req.Action})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": done})
}

func (s *Server) handleListRevisions(w http.ResponseWriter, r *http.Request) {
	revs, err := s.store.Revisions(r.PathValue("id"), 20)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revs})
}

func (s *Server) handleRestoreRevision(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedVersion int `json:"expectedVersion"`
	}
	if decodeJSON(r, &input) != nil || input.ExpectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "恢复必须提供当前 expectedVersion")
		return
	}
	id := r.PathValue("id")
	revID := r.PathValue("revID")
	rev, content, err := s.store.GetRevision(revID)
	if err != nil {
		writeError(w, http.StatusNotFound, "历史版本不存在")
		return
	}
	if rev.NoteID != id {
		writeError(w, http.StatusBadRequest, "历史版本与笔记不匹配")
		return
	}
	title := rev.Title
	note, err := s.store.UpdateNote(id, store.NotePatch{Content: &content, Title: &title, Source: "web", ForceRevision: true, ExpectedVersion: &input.ExpectedVersion})
	if err != nil {
		if errors.Is(err, store.ErrVersionConflict) {
			writeError(w, http.StatusConflict, "笔记已变化，请重新对比后恢复")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Broadcast("note.updated", note)
	writeJSON(w, http.StatusOK, note)
}

func (s *Server) handleExportNote(w http.ResponseWriter, r *http.Request) {
	note, err := s.store.GetNote(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "笔记不存在")
		return
	}
	filename := textutil.Slug(note.Title)
	if filename == "" {
		filename = note.ID
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.md"`, filename))
	_, _ = w.Write([]byte(renderMarkdownFile(note)))
}

const metadataMarker = "<!-- locknote:metadata:v1\n"

type markdownMetadata struct {
	Title    string   `json:"title"`
	Notebook string   `json:"notebook"`
	Tags     []string `json:"tags"`
}

func renderMarkdownFile(n *store.Note) string {
	data, _ := json.Marshal(markdownMetadata{n.Title, n.NotebookName, n.Tags})
	return n.Content + "\n\n" + metadataMarker + string(data) + "\n-->\n"
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}

func (s *Server) handleGetRevision(w http.ResponseWriter, r *http.Request) {
	rev, content, err := s.store.GetRevision(r.PathValue("revID"))
	if err != nil || rev.NoteID != r.PathValue("id") {
		writeError(w, 404, "历史版本不存在")
		return
	}
	writeJSON(w, 200, map[string]any{"revision": rev, "content": content})
}

func (s *Server) handleDiscardPlaceholder(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DiscardPlaceholder(r.PathValue("id")); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
