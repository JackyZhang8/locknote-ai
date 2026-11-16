package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *Server) handlePluginConversations(w http.ResponseWriter, r *http.Request) {
	if !s.enabledPlugin(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	id, cid := r.PathValue("id"), r.PathValue("conversation")
	var result any = map[string]bool{"ok": true}
	var err error
	switch {
	case r.Method == "GET" && cid == "":
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		result, err = s.cfg.Plugins.ListConversations(id, offset)
	case r.Method == "GET":
		before := int64(-1)
		if value := r.URL.Query().Get("before"); value != "" {
			before, err = strconv.ParseInt(value, 10, 64)
			if err != nil {
				break
			}
		}
		result, err = s.cfg.Plugins.ReadConversation(id, cid, before)
	case r.Method == "DELETE":
		err = s.cfg.Plugins.DeleteConversation(id, cid)
	default:
		var req struct {
			Title    string            `json:"title"`
			Expected int64             `json:"expectedSeq"`
			Events   []json.RawMessage `json:"events"`
			ActiveID *string           `json:"activeId"`
		}
		if err = decodeJSON(r, &req); err != nil {
			break
		}
		switch {
		case r.Method == "POST" && cid == "":
			result, err = s.cfg.Plugins.CreateConversation(id, req.Title)
		case r.Method == "PUT" && cid == "" && req.ActiveID != nil:
			err = s.cfg.Plugins.ActivateConversation(id, *req.ActiveID)
		case r.Method == "PATCH" && cid != "":
			err = s.cfg.Plugins.RenameConversation(id, cid, req.Title)
		case r.Method == "POST" && cid != "":
			result, err = s.cfg.Plugins.AppendConversation(id, cid, req.Expected, req.Events)
		default:
			writeError(w, 400, "Invalid conversation operation")
			return
		}
	}
	if err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
