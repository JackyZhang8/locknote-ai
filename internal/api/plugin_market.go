package api

import (
	"errors"
	"net/http"

	"locknote-mcp/internal/plugins"
)

func (s *Server) pluginMarket() *plugins.Marketplace {
	s.marketOnce.Do(func() { s.market = plugins.NewMarketplace(s.cfg.Plugins, plugins.OfficialCatalogURL) })
	return s.market
}
func (s *Server) handlePluginMarket(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Query().Get("cached") == "1" {
		if cached, ok := s.pluginMarket().CachedCatalog(); ok {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}
	result, err := s.pluginMarket().Catalog(r.Context(), r.URL.Query().Get("refresh") == "1")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) handlePrepareMarketPlugin(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	var input struct {
		ID      string `json:"id"`
		Version string `json:"version"`
		SHA256  string `json:"sha256"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := decodeJSON(r, &input); err != nil || input.ID == "" || input.Version == "" || len(input.SHA256) != 64 {
		pluginError(w, errors.New("需要插件 ID、版本和 SHA-256"))
		return
	}
	prepared, err := s.pluginMarket().Prepare(r.Context(), input.ID, input.Version, input.SHA256)
	if err != nil {
		pluginError(w, err)
		return
	}
	if r.Context().Err() != nil {
		s.pluginMarket().Discard(prepared.Token)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, prepared)
}
func (s *Server) handleInstallMarketPlugin(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	var input struct {
		Token          string  `json:"token"`
		ExpectedDigest *string `json:"expectedDigest"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := decodeJSON(r, &input); err != nil || input.Token == "" || input.ExpectedDigest == nil {
		pluginError(w, errors.New("需要有效下载凭据及确认版本"))
		return
	}
	if r.Context().Err() != nil {
		return
	}
	record, err := s.pluginMarket().Install(input.Token, *input.ExpectedDigest)
	if err != nil {
		pluginError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}
func (s *Server) handleDiscardMarketPlugin(w http.ResponseWriter, r *http.Request) {
	if !s.pluginSession(w, r, false) {
		return
	}
	s.pluginMarket().Discard(r.PathValue("token"))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
