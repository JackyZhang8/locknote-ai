package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"locknote-mcp/internal/store"
)

// settingSpec is the allow-list of preferences the UI may persist. Anything
// else is rejected, so a malformed client cannot write arbitrary rows into
// the settings table. Values are stored as strings under the "ui." prefix.
type settingSpec struct {
	key     string
	def     string
	allowed []string // nil = free-form text
	maxLen  int
}

var settingSpecs = []settingSpec{
	{"theme", "green", []string{"green", "coral", "sunset", "blue", "lavender"}, 0},
	{"language", "zh-CN", []string{"zh-CN", "en-US"}, 0},
	{"editorMode", "auto", []string{"auto", "edit", "preview"}, 0},
	{"fontSize", "medium", []string{"small", "medium", "large"}, 0},
	{"aiNotebook", "", nil, 80},
	{"showAiBadge", "true", []string{"true", "false"}, 0},
}

func settingByKey(key string) (settingSpec, bool) {
	for _, spec := range settingSpecs {
		if spec.key == key {
			return spec, true
		}
	}
	return settingSpec{}, false
}

func (s *Server) readSettings() map[string]string {
	out := make(map[string]string, len(settingSpecs))
	for _, spec := range settingSpecs {
		out[spec.key] = s.store.GetSetting("ui."+spec.key, spec.def)
	}
	if theme := out["theme"]; theme == "system" || theme == "light" || theme == "dark" {
		out["theme"] = "green"
	}
	return out
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"settings": s.readSettings()})
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var payload map[string]any
	if err := decodeJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}

	changed := map[string]string{}
	for key, raw := range payload {
		spec, ok := settingByKey(key)
		if !ok {
			continue // unknown keys are ignored, not an error
		}
		value, valid := coerceSetting(spec, raw)
		if !valid {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("设置项 %s 的值不合法", key))
			return
		}
		if err := s.store.SetSetting("ui."+key, value); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		changed[key] = value
	}
	s.publishEvent(Event{Type: "settings.changed", Title: "settings"})
	writeJSON(w, http.StatusOK, map[string]any{"settings": s.readSettings(), "changed": changed})
}

func coerceSetting(spec settingSpec, raw any) (string, bool) {
	var value string
	switch v := raw.(type) {
	case bool:
		value = "false"
		if v {
			value = "true"
		}
	case string:
		value = strings.TrimSpace(v)
	case json.Number:
		value = v.String()
	default:
		return "", false
	}
	if spec.maxLen > 0 && len([]rune(value)) > spec.maxLen {
		return "", false
	}
	if spec.allowed != nil {
		for _, allowed := range spec.allowed {
			if value == allowed {
				return value, true
			}
		}
		return "", false
	}
	return value, true
}

// ---------------------------------------------------------------------------
// export / import
// ---------------------------------------------------------------------------

func (s *Server) handleExportAll(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format != "" && format != "markdown" {
		writeError(w, http.StatusBadRequest, "format 只支持 markdown")
		return
	}
	snapshot, err := s.store.OpenNoteExport(r.Context())
	if err != nil {
		if r.Context().Err() == nil {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	defer snapshot.Close()
	w.Header().Set("X-Export-Notes", strconv.Itoa(snapshot.Count))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=locknote-ai-%s.zip", time.Now().Format("20060102-1504")))
	if err := streamMarkdownZIP(r.Context(), w, snapshot.Count, snapshot.NextBatch); err != nil {
		// Headers may already be sent. Abort rather than delivering a truncated
		// archive as a successful download. The pipeline has already joined its reader.
		if r.Context().Err() == nil {
			panic(http.ErrAbortHandler)
		}
	}
}

func writeZipEntry(zw *zip.Writer, name, content string) error {
	f, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = f.Write([]byte(content))
	return err
}

type importFile struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func (s *Server) handleImportMarkdown(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Files []importFile `json:"files"`
	}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			writeError(w, 400, "文件过大或格式不正确")
			return
		}
		defer r.MultipartForm.RemoveAll()
		var total int64
		for _, headers := range r.MultipartForm.File {
			for _, header := range headers {
				file, err := header.Open()
				if err != nil {
					writeError(w, 400, "无法读取文件")
					return
				}
				data, err := io.ReadAll(io.LimitReader(file, (64<<20)+1))
				file.Close()
				if err != nil || len(data) > 64<<20 {
					writeError(w, 400, "文件过大")
					return
				}
				if strings.EqualFold(path.Ext(header.Filename), ".zip") {
					archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
					if err != nil {
						writeError(w, 400, "ZIP 文件无效")
						return
					}
					for _, entry := range archive.File {
						ext := strings.ToLower(path.Ext(entry.Name))
						if entry.FileInfo().IsDir() || strings.HasPrefix(entry.Name, "__MACOSX/") || (ext != ".md" && ext != ".markdown") {
							continue
						}
						// Our generated README is documentation, not a note.
						if len(payload.Files) >= 10000 {
							writeError(w, 400, "一次最多导入 10000 篇笔记")
							return
						}
						stream, err := entry.Open()
						if err != nil {
							writeError(w, 400, "无法读取 ZIP")
							return
						}
						content, err := io.ReadAll(io.LimitReader(stream, (64<<20)-total+1))
						stream.Close()
						total += int64(len(content))
						if err != nil || total > 64<<20 {
							writeError(w, 400, "解压后内容超过 64 MB")
							return
						}
						if entry.Name == "README.md" && strings.HasPrefix(string(content), "# LockNote.app export") && !strings.Contains(string(content), metadataMarker) {
							continue
						}
						payload.Files = append(payload.Files, importFile{entry.Name, string(content)})
					}
				} else {
					ext := strings.ToLower(path.Ext(header.Filename))
					if ext != ".md" && ext != ".markdown" && ext != ".txt" {
						writeError(w, 400, "只支持 Markdown 或 ZIP")
						return
					}
					total += int64(len(data))
					if total > 64<<20 {
						writeError(w, 400, "导入内容超过 64 MB")
						return
					}
					payload.Files = append(payload.Files, importFile{header.Filename, string(data)})
				}
			}
		}
	} else if err := decodeJSON(r, &payload); err != nil {
		writeError(w, 400, "请求格式不正确")
		return
	}
	if len(payload.Files) == 0 {
		writeError(w, http.StatusBadRequest, "没有收到文件")
		return
	}
	if len(payload.Files) > 10000 {
		writeError(w, http.StatusBadRequest, "一次最多导入 10000 个文件")
		return
	}

	created, skipped, updated := 0, 0, 0
	errs := []string{}
	for _, f := range payload.Files {
		content := strings.ReplaceAll(f.Content, "\r\n", "\n")
		if strings.TrimSpace(content) == "" {
			skipped++
			continue
		}
		title, notebook, tags, body := parseMarkdownImport(f.Name, content)
		// CreateNote only resolves existing notebooks, so make sure a notebook
		// named in the metadata footer exists before the note is inserted.
		if notebook != "" {
			if _, _, err := s.store.CreateNotebook(notebook, "", "", ""); err != nil {
				errs = append(errs, fmt.Sprintf("%s: %v", f.Name, err))
				continue
			}
		}
		_, isNew, isSkipped, err := s.store.ImportNote(store.NoteInput{
			Title: title, Content: body, Notebook: notebook, Tags: tags,
		}, r.URL.Query().Get("duplicates"))
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", f.Name, err))
			continue
		}
		if isSkipped {
			skipped++
			continue
		}
		if isNew {
			created++
		} else {
			updated++
		}
	}
	if created+updated > 0 {
		s.publishEvent(Event{Type: "notes.imported"})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"created": created, "updated": updated, "skipped": skipped, "errors": errs,
	})
}

// Only the versioned footer produced by Locknote is interpreted as metadata.
func parseMarkdownImport(name, content string) (title, notebook string, tags []string, body string) {
	body = content
	trimmed := strings.TrimRight(content, "\n")
	if index := strings.LastIndex(trimmed, "\n\n"+metadataMarker); index >= 0 && strings.HasSuffix(trimmed, "\n-->") {
		data := trimmed[index+2+len(metadataMarker) : len(trimmed)-len("\n-->")]
		var meta markdownMetadata
		if json.Unmarshal([]byte(data), &meta) == nil {
			return meta.Title, meta.Notebook, meta.Tags, trimmed[:index]
		}
	}
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "# ") {
			title = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "# "))
			break
		}
	}
	if title == "" {
		title = strings.TrimSuffix(path.Base(name), path.Ext(name))
	}
	return title, "", nil, body
}

func (s *Server) handleEmptyTrash(w http.ResponseWriter, r *http.Request) {
	n, err := s.store.EmptyTrash()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.publishEvent(Event{Type: "notes.batch", Title: "trash.emptied"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": n})
}

// trashProgress is one NDJSON line of POST /api/trash/empty-stream.
type trashProgress struct {
	Total     int    `json:"total"`
	Deleted   int    `json:"deleted"`
	Remaining int    `json:"remaining"`
	Done      bool   `json:"done,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
	Error     string `json:"error,omitempty"`
	Stage     string `json:"stage,omitempty"`
}

// emptyTrashProgress deletes ids one independent transaction at a time and
// reports after every note. A cancelled context or an emit that returns false
// (client disconnected / write failed) stops the loop early. Deletions already
// committed are never rolled back, which is exactly what makes the operation
// safely interruptible.
func (s *Server) emptyTrashProgress(ctx context.Context, ids []string,
	emit func(trashProgress) bool) trashProgress {

	total := len(ids)
	state := trashProgress{Total: total, Remaining: total}
	for _, id := range ids {
		select {
		case <-ctx.Done():
			state.Cancelled = true
			return state
		default:
		}
		if err := s.store.EmptyTrashOne(id); err != nil {
			// ErrNotFound means another client removed it first. The id is
			// gone from the trash either way, so the goal is met.
			if err != store.ErrNotFound {
				state.Error = err.Error()
				return state
			}
		}
		state.Deleted++
		state.Remaining = total - state.Deleted
		if !emit(state) {
			state.Cancelled = true
			return state
		}
	}
	state.Done = true
	return state
}

// handleEmptyTrashStream is the UI's cancellable version of empty-trash:
// NDJSON progress, one transaction per note, and an immediate stop when the
// browser aborts the fetch.
func (s *Server) handleEmptyTrashStream(w http.ResponseWriter, r *http.Request) {
	ids, err := s.store.ListTrashIDs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Trash-Total", strconv.Itoa(len(ids)))
	flusher, _ := w.(http.Flusher)
	enc := json.NewEncoder(w)
	emit := func(p trashProgress) bool {
		if err := enc.Encode(p); err != nil {
			return false
		}
		if flusher != nil {
			flusher.Flush()
		}
		return true
	}

	// Announce the workload before the first delete so the dialog shows a real
	// "0 / N" rather than an indeterminate bar.
	if !emit(trashProgress{Total: len(ids), Remaining: len(ids), Stage: "start"}) {
		return
	}
	state := s.emptyTrashProgress(r.Context(), ids, emit)
	if state.Deleted > 0 {
		s.publishEvent(Event{Type: "notes.batch", Title: "trash.emptied"})
	}
	// Best-effort terminal line: on cancellation the client may already be gone.
	emit(state)
}
