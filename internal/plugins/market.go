package plugins

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

const OfficialCatalogURL = "http://cdn.relaycat.cn/locknote_plugins/plugins.json"
const maxCatalogBytes = 1 << 20

type MarketRelease struct {
	Version       string   `json:"version"`
	APIVersion    int      `json:"apiVersion"`
	MinAppVersion string   `json:"minAppVersion"`
	Capabilities  []string `json:"capabilities"`
	File          string   `json:"file"`
	DownloadURL   string   `json:"downloadUrl,omitempty"`
	Size          int64    `json:"size"`
	SHA256        string   `json:"sha256"`
}
type MarketPlugin struct {
	ID            string                       `json:"id"`
	Name          string                       `json:"name"`
	Description   string                       `json:"description"`
	Author        string                       `json:"author"`
	License       string                       `json:"license"`
	SourceURL     string                       `json:"sourceUrl"`
	DefaultLocale string                       `json:"defaultLocale"`
	Locales       map[string]map[string]string `json:"locales"`
	LatestVersion string                       `json:"latestVersion"`
	Releases      []MarketRelease              `json:"releases"`
}
type MarketCatalog struct {
	SchemaVersion int            `json:"schemaVersion"`
	UpdatedAt     string         `json:"updatedAt"`
	Plugins       []MarketPlugin `json:"plugins"`
}
type MarketSnapshot struct {
	Catalog    MarketCatalog `json:"catalog"`
	FetchedAt  time.Time     `json:"fetchedAt"`
	AppVersion string        `json:"appVersion"`
	Stale      bool          `json:"stale"`
	Warning    string        `json:"warning,omitempty"`
	Revalidate bool          `json:"revalidate,omitempty"`
}
type MarketPrepared struct {
	Token     string    `json:"token"`
	Preview   Preview   `json:"preview"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type marketPackage struct {
	path    string
	expires time.Time
	sha256  string
	size    int64
}

// Marketplace never accepts remote URLs from callers. file is resolved relative
// to the fixed catalog directory, so moving the published directory is safe.
type Marketplace struct {
	manager     *Manager
	catalogURL  string
	client      *http.Client
	mu          sync.Mutex
	fetchGate   chan struct{}
	cache       *MarketSnapshot
	prepared    map[string]marketPackage
	downloadDir string
	cacheFile   string
	slots       chan struct{}
}

func NewMarketplace(manager *Manager, catalogURL string) *Marketplace {
	root := filepath.Join(manager.Directory(), "_market")
	m := &Marketplace{manager: manager, catalogURL: catalogURL, downloadDir: filepath.Join(root, "downloads"), cacheFile: filepath.Join(root, "catalog.json"), prepared: map[string]marketPackage{}, slots: make(chan struct{}, 1), fetchGate: make(chan struct{}, 1)}
	m.client = &http.Client{Timeout: 90 * time.Second, CheckRedirect: m.checkRedirect}
	// Only this process can consume tokens. Remove incomplete previous downloads.
	_ = os.RemoveAll(m.downloadDir)
	if data, err := readMarketFile(m.cacheFile, maxCatalogBytes+4096); err == nil && len(data) <= maxCatalogBytes+4096 {
		var cached MarketSnapshot
		if json.Unmarshal(data, &cached) == nil && validateMarket(cached.Catalog) == nil && !cached.FetchedAt.IsZero() {
			m.cache = &cached
		}
	}
	return m
}
func (m *Marketplace) checkRedirect(req *http.Request, via []*http.Request) error {
	base, _ := url.Parse(m.catalogURL)
	if base == nil || len(via) > 4 || (req.URL.Scheme != base.Scheme && !(base.Scheme == "http" && req.URL.Scheme == "https")) || req.URL.Host != base.Host || !strings.HasPrefix(path.Clean(req.URL.Path), base.ResolveReference(&url.URL{Path: "."}).Path) || req.URL.User != nil {
		return errors.New("插件市场拒绝跨来源或目录的重定向")
	}
	// Compare with every preceding hop, not only the initial HTTP source.
	// Once TLS has been used anywhere in the chain, it must not be downgraded.
	if req.URL.Scheme == "http" {
		for _, previous := range via {
			if previous.URL.Scheme == "https" {
				return errors.New("插件市场拒绝从 HTTPS 降级到 HTTP")
			}
		}
	}
	return nil
}
func validateMarket(c MarketCatalog) error {
	if c.SchemaVersion != 1 || len(c.Plugins) > 100 {
		return errors.New("插件市场目录版本不支持或条目过多")
	}
	ids := map[string]bool{}
	for _, p := range c.Plugins {
		if !validID(p.ID) || ids[p.ID] || strings.TrimSpace(p.Name) == "" || len(p.Name) > 120 || len(p.Description) > 4096 || len(p.Releases) == 0 || len(p.Releases) > 100 {
			return errors.New("插件市场条目无效或重复")
		}
		ids[p.ID] = true
		versions := map[string]bool{}
		for _, r := range p.Releases {
			_, vErr := versionParts(r.Version)
			_, mErr := versionParts(r.MinAppVersion)
			hash, hashErr := hex.DecodeString(r.SHA256)
			if len(r.Version) > 128 || len(r.MinAppVersion) > 128 || vErr != nil || mErr != nil || strings.HasPrefix(r.Version, "v") || versions[r.Version] || r.APIVersion < 1 || r.File != p.ID+"-"+r.Version+".zip" || r.Size <= 0 || r.Size > MaxPackageBytes || hashErr != nil || len(hash) != 32 || len(r.Capabilities) > 64 {
				return errors.New("插件市场版本、路径、大小或校验信息无效")
			}
			versions[r.Version] = true
		}
		if !versions[p.LatestVersion] {
			return errors.New("插件市场最新版本不存在")
		}
	}
	return nil
}

// CachedCatalog is an immediate disk-loaded/in-memory snapshot. It never waits
// for an in-flight refresh and does not turn an expired cache into a fresh one.
func (m *Marketplace) CachedCatalog() (MarketSnapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cache == nil {
		return MarketSnapshot{}, false
	}
	result := *m.cache
	result.AppVersion = m.manager.version
	result.Revalidate = time.Since(result.FetchedAt) >= 10*time.Minute
	return result, true
}
func (m *Marketplace) Catalog(ctx context.Context, refresh bool) (MarketSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return MarketSnapshot{}, err
	}
	if cached, ok := m.CachedCatalog(); !refresh && ok && !cached.Revalidate {
		return cached, nil
	}
	// Waiting for the single fetch slot must remain cancellable. Prepare owns a
	// separate download slot, so a cancelled waiter must release that slot too.
	select {
	case m.fetchGate <- struct{}{}:
	case <-ctx.Done():
		return MarketSnapshot{}, ctx.Err()
	}
	defer func() { <-m.fetchGate }()
	if err := ctx.Err(); err != nil {
		return MarketSnapshot{}, err
	}
	cached, hasCache := m.CachedCatalog()
	if !refresh && hasCache && !cached.Revalidate {
		return cached, nil
	}
	fetch := func() (MarketSnapshot, error) {
		requestCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, m.catalogURL, nil)
		if err != nil {
			return MarketSnapshot{}, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Cache-Control", "no-cache")
		resp, err := m.client.Do(req)
		if err != nil {
			return MarketSnapshot{}, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return MarketSnapshot{}, fmt.Errorf("插件市场请求失败（HTTP %d）", resp.StatusCode)
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogBytes+1))
		if err != nil {
			return MarketSnapshot{}, err
		}
		if len(raw) > maxCatalogBytes {
			return MarketSnapshot{}, errors.New("插件市场目录超过 1 MiB")
		}
		var catalog MarketCatalog
		if err = json.Unmarshal(raw, &catalog); err != nil {
			return MarketSnapshot{}, errors.New("插件市场目录不是有效 JSON")
		}
		if err = validateMarket(catalog); err != nil {
			return MarketSnapshot{}, err
		}
		return MarketSnapshot{Catalog: catalog, FetchedAt: time.Now().UTC(), AppVersion: m.manager.version}, nil
	}
	result, err := fetch()
	if err != nil {
		if ctx.Err() != nil {
			return MarketSnapshot{}, ctx.Err()
		}
		if hasCache {
			result = cached
			result.Stale = true
			result.Warning = "无法刷新插件市场，正在显示本地缓存：" + err.Error()
			result.AppVersion = m.manager.version
			return result, nil
		}
		return MarketSnapshot{}, err
	}
	m.mu.Lock()
	m.cache = &result
	m.mu.Unlock()
	data, _ := json.Marshal(result)
	if os.MkdirAll(filepath.Dir(m.cacheFile), 0700) == nil {
		if tmp, e := os.CreateTemp(filepath.Dir(m.cacheFile), ".catalog-*"); e == nil {
			_, e = tmp.Write(data)
			closeErr := tmp.Close()
			if e == nil && closeErr == nil {
				_ = os.Rename(tmp.Name(), m.cacheFile)
			}
			_ = os.Remove(tmp.Name())
		}
	}
	return result, nil
}
func (m *Marketplace) cleanupLocked() {
	for token, item := range m.prepared {
		if time.Now().After(item.expires) {
			_ = os.Remove(item.path)
			delete(m.prepared, token)
		}
	}
}
func (m *Marketplace) Prepare(ctx context.Context, id, version, expectedHash string) (MarketPrepared, error) {
	select {
	case m.slots <- struct{}{}:
		defer func() { <-m.slots }()
	default:
		return MarketPrepared{}, errors.New("已有插件正在下载，请稍后重试")
	}
	catalog, err := m.Catalog(ctx, false)
	if err != nil {
		return MarketPrepared{}, err
	}
	var selected *MarketRelease
	for _, p := range catalog.Catalog.Plugins {
		if p.ID == id {
			for _, r := range p.Releases {
				if r.Version == version {
					release := r
					selected = &release
				}
			}
		}
	}
	if selected == nil || !strings.EqualFold(selected.SHA256, expectedHash) {
		return MarketPrepared{}, errors.New("插件市场版本已变化，请刷新后重试")
	}
	r := *selected
	if r.APIVersion != 1 || !marketCompatible(m.manager.version, r.MinAppVersion) {
		return MarketPrepared{}, errors.New("此插件版本与当前应用不兼容")
	}
	m.mu.Lock()
	m.cleanupLocked()
	full := len(m.prepared) >= 4
	m.mu.Unlock()
	if full {
		return MarketPrepared{}, errors.New("待确认安装过多，请关闭已有确认框")
	}
	base, err := url.Parse(m.catalogURL)
	if err != nil {
		return MarketPrepared{}, err
	}
	download := base.ResolveReference(&url.URL{Path: r.File}).String()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, download, nil)
	if err != nil {
		return MarketPrepared{}, err
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return MarketPrepared{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return MarketPrepared{}, fmt.Errorf("插件下载失败（HTTP %d）", resp.StatusCode)
	}
	if resp.ContentLength > MaxPackageBytes {
		return MarketPrepared{}, errors.New("插件下载超过大小限制")
	}
	if err = os.MkdirAll(m.downloadDir, 0700); err != nil {
		return MarketPrepared{}, err
	}
	tmp, err := os.CreateTemp(m.downloadDir, "package-*.zip")
	if err != nil {
		return MarketPrepared{}, err
	}
	keep := false
	defer func() {
		_ = tmp.Close()
		if !keep {
			_ = os.Remove(tmp.Name())
		}
	}()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, hash), io.LimitReader(resp.Body, r.Size+1))
	if err != nil {
		return MarketPrepared{}, err
	}
	if size != r.Size || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), r.SHA256) {
		return MarketPrepared{}, errors.New("插件大小或 SHA-256 校验失败，请重新下载")
	}
	if err = tmp.Close(); err != nil {
		return MarketPrepared{}, err
	}
	if err = ctx.Err(); err != nil {
		return MarketPrepared{}, err
	}
	raw, err := readMarketFile(tmp.Name(), MaxPackageBytes)
	if err != nil {
		return MarketPrepared{}, err
	}
	preview, err := m.manager.Preview(raw)
	if err != nil {
		return MarketPrepared{}, err
	}
	man := preview.Manifest
	a := append([]string{}, man.Capabilities...)
	b := append([]string{}, r.Capabilities...)
	sort.Strings(a)
	sort.Strings(b)
	if man.ID != id || man.Version != r.Version || man.APIVersion != r.APIVersion || man.MinAppVersion != r.MinAppVersion || !reflect.DeepEqual(a, b) {
		return MarketPrepared{}, errors.New("插件清单与市场发布信息不一致")
	}
	var secret [24]byte
	if _, err = rand.Read(secret[:]); err != nil {
		return MarketPrepared{}, err
	}
	token := hex.EncodeToString(secret[:])
	expires := time.Now().Add(15 * time.Minute)
	m.mu.Lock()
	m.prepared[token] = marketPackage{path: tmp.Name(), expires: expires, sha256: r.SHA256, size: r.Size}
	m.mu.Unlock()
	keep = true
	return MarketPrepared{Token: token, Preview: preview, ExpiresAt: expires}, nil
}
func (m *Marketplace) Discard(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.prepared[token]; ok {
		_ = os.Remove(p.path)
		delete(m.prepared, token)
	}
	m.cleanupLocked()
}
func (m *Marketplace) Install(token, expectedDigest string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupLocked()
	p, ok := m.prepared[token]
	if !ok {
		return Record{}, errors.New("下载确认已失效，请重新下载插件")
	}
	raw, err := readMarketFile(p.path, MaxPackageBytes)
	if err != nil {
		return Record{}, err
	}
	sum := sha256.Sum256(raw)
	if int64(len(raw)) != p.size || !strings.EqualFold(hex.EncodeToString(sum[:]), p.sha256) {
		_ = os.Remove(p.path)
		delete(m.prepared, token)
		return Record{}, errors.New("已下载的插件校验失败，请重新下载")
	}
	record, err := m.manager.InstallApproved(raw, expectedDigest)
	if err != nil {
		return Record{}, err
	}
	_ = os.Remove(p.path)
	delete(m.prepared, token)
	return record, nil
}

// Follow SemVer prerelease ordering, while retaining the installer's numeric
// component limits. A prerelease host must not satisfy a final-release minimum.
func marketCompatible(current, minimum string) bool {
	if !compatible(current, minimum) {
		return false
	}
	c, _ := versionParts(current)
	v, _ := versionParts(minimum)
	if c != v {
		return true
	}
	_, cp, ch := strings.Cut(current, "-")
	_, mp, mh := strings.Cut(minimum, "-")
	if !ch {
		return true
	}
	if !mh {
		return false
	}
	a, b := strings.Split(cp, "."), strings.Split(mp, ".")
	numeric := func(value string) bool {
		for _, r := range value {
			if r < '0' || r > '9' {
				return false
			}
		}
		return true
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] == b[i] {
			continue
		}
		an, bn := numeric(a[i]), numeric(b[i])
		if an && bn {
			if len(a[i]) != len(b[i]) {
				return len(a[i]) > len(b[i])
			}
			return a[i] > b[i]
		}
		if an != bn {
			return !an
		}
		return a[i] > b[i]
	}
	return len(a) >= len(b)
}

func readMarketFile(name string, limit int64) ([]byte, error) {
	file, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("插件市场文件超过大小限制")
	}
	return data, nil
}
