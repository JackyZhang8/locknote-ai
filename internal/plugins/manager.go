// Package plugins stores user-approved desktop plugins. Plugins are trusted
// browser code, not a security sandbox; this package never executes their code.
package plugins

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	MaxPackageBytes  = 16 << 20
	MaxExpandedBytes = 32 << 20
	MaxFiles         = 512
	MaxDataBytes     = 256 << 10
)

var ErrNotFound = errors.New("插件不存在")
var ErrDataChanged = errors.New("插件配置已变化，请重新载入后再保存")
var ErrInstallChanged = errors.New("插件安装状态已变化，请重新选择安装包并确认")
var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,95}$`)
var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$`)

type Command struct {
	TitleKey string `json:"titleKey,omitempty"`
	ID       string `json:"id"`
	Title    string `json:"title"`
	Hotkey   string `json:"hotkey,omitempty"`
}
type Manifest struct {
	DefaultLocale    string                       `json:"defaultLocale,omitempty"`
	Locales          map[string]map[string]string `json:"locales,omitempty"`
	ID               string                       `json:"id"`
	Name             string                       `json:"name"`
	Version          string                       `json:"version"`
	APIVersion       int                          `json:"apiVersion"`
	MinAppVersion    string                       `json:"minAppVersion"`
	Entry            string                       `json:"entry"`
	Styles           string                       `json:"styles,omitempty"`
	Description      string                       `json:"description,omitempty"`
	Author           string                       `json:"author,omitempty"`
	Capabilities     []string                     `json:"capabilities"`
	ActivationEvents []string                     `json:"activationEvents,omitempty"`
	Commands         []Command                    `json:"commands,omitempty"`
}
type Record struct {
	Manifest    Manifest  `json:"manifest"`
	Enabled     bool      `json:"enabled"`
	InstalledAt time.Time `json:"installedAt"`
	Digest      string    `json:"digest"`
}
type Preview struct {
	Action        string   `json:"action"`
	SameName      []Record `json:"sameName,omitempty"`
	Manifest      Manifest `json:"manifest"`
	Files         int      `json:"files"`
	ExpandedBytes uint64   `json:"expandedBytes"`
	Digest        string   `json:"digest"`
	Replaces      *Record  `json:"replaces,omitempty"`
}
type Manager struct {
	conversationIO    sync.RWMutex
	conversationLocks sync.Map
	mu                sync.Mutex
	root              string
	version           string
	records           map[string]Record
}
type archive struct {
	preview Preview
	files   map[string][]byte
}

func New(root, appVersion string) (*Manager, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if _, err = versionParts(appVersion); err != nil {
		return nil, fmt.Errorf("应用版本无效: %w", err)
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	m := &Manager{root: root, version: appVersion, records: map[string]Record{}}
	raw, err := os.ReadFile(filepath.Join(root, "_state.json"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(raw, &m.records); err != nil {
			return nil, fmt.Errorf("插件状态损坏: %w", err)
		}
		if m.records == nil {
			m.records = map[string]Record{}
		}
		for id, r := range m.records {
			if id != r.Manifest.ID || !validID(id) || !versionPattern.MatchString(r.Manifest.Version) {
				return nil, errors.New("插件状态包含非法标识")
			}
		}
	}
	return m, nil
}
func (m *Manager) Directory() string { return m.root }
func validID(id string) bool         { return idPattern.MatchString(id) && !strings.Contains(id, "..") }
func versionParts(v string) ([3]uint64, error) {
	var out [3]uint64
	v = strings.TrimPrefix(v, "v")
	groups := versionPattern.FindStringSubmatch(v)
	if groups == nil {
		return out, fmt.Errorf("版本号 %q 应为 MAJOR.MINOR.PATCH", v)
	}
	if groups[4] != "" {
		for _, part := range strings.Split(groups[4], ".") {
			if part == "" {
				return out, errors.New("预发布版本标识不能为空")
			}
			numeric := true
			for _, c := range part {
				if c < '0' || c > '9' {
					numeric = false
				}
			}
			if numeric && len(part) > 1 && part[0] == '0' {
				return out, errors.New("预发布版本数字不能带前导零")
			}
		}
	}
	for i := 0; i < 3; i++ {
		n, err := strconv.ParseUint(groups[i+1], 10, 32)
		if err != nil {
			return out, err
		}
		out[i] = n
	}
	return out, nil
}
func compatible(current, minimum string) bool {
	c, e1 := versionParts(current)
	v, e2 := versionParts(minimum)
	if e1 != nil || e2 != nil {
		return false
	}
	for i := 0; i < 3; i++ {
		if c[i] > v[i] {
			return true
		}
		if c[i] < v[i] {
			return false
		}
	}
	_, cp, cpre := strings.Cut(strings.TrimPrefix(current, "v"), "-")
	_, mp, mpre := strings.Cut(strings.TrimPrefix(minimum, "v"), "-")
	if !cpre {
		return true
	}
	if !mpre {
		return false
	}
	cs, ms := strings.Split(cp, "."), strings.Split(mp, ".")
	for i := 0; i < len(cs) && i < len(ms); i++ {
		if cs[i] == ms[i] {
			continue
		}
		cn, ce := strconv.ParseUint(cs[i], 10, 64)
		mn, me := strconv.ParseUint(ms[i], 10, 64)
		if ce == nil && me == nil {
			return cn > mn
		}
		if ce == nil {
			return false
		}
		if me == nil {
			return true
		}
		return cs[i] > ms[i]
	}
	return len(cs) >= len(ms)
}
func safePath(name string) bool {
	if name == "" || len(name) > 240 || !utf8.ValidString(name) ||
		strings.ContainsAny(name, "\\:\x00<>\"|?*") || strings.HasPrefix(name, "/") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return false
		}
		base, _, _ := strings.Cut(part, ".")
		base = strings.ToUpper(strings.TrimRight(base, " ."))
		switch base {
		case "CON", "PRN", "AUX", "NUL":
			return false
		}
		if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
			return false
		}
	}
	return path.Clean(name) == name
}
func (m *Manager) validate(man Manifest) error {
	if len(man.DefaultLocale) > 35 || len(man.Locales) > 32 {
		return errors.New("插件语言声明过多或无效")
	}
	for locale, dictionary := range man.Locales {
		if len(locale) == 0 || len(locale) > 35 || len(dictionary) > 1024 {
			return errors.New("插件语言字典无效")
		}
		for key, value := range dictionary {
			if key == "" || len(key) > 160 || len(value) > 4096 {
				return errors.New("插件翻译条目无效")
			}
		}
	}

	if !validID(man.ID) {
		return errors.New("插件 ID 只能包含小写字母、数字、点和连字符")
	}
	if strings.TrimSpace(man.Name) == "" || len(man.Name) > 120 || len(man.Description) > 4096 || len(man.Author) > 256 {
		return errors.New("插件名称或介绍无效")
	}
	if _, err := versionParts(man.Version); err != nil {
		return err
	}
	if strings.HasPrefix(man.Version, "v") {
		return errors.New("插件版本不能包含 v 前缀")
	}
	if man.APIVersion != 1 {
		return errors.New("不支持的插件 apiVersion；当前为 1")
	}
	if _, err := versionParts(man.MinAppVersion); err != nil {
		return fmt.Errorf("minAppVersion: %w", err)
	}
	if !compatible(m.version, man.MinAppVersion) {
		return fmt.Errorf("需要 Locknote AI %s 或更新版本", man.MinAppVersion)
	}
	if !safePath(man.Entry) || !(strings.HasSuffix(man.Entry, ".js") || strings.HasSuffix(man.Entry, ".mjs")) {
		return errors.New("插件入口必须是包内的 JavaScript 文件")
	}
	if man.Styles != "" && (!safePath(man.Styles) || !strings.HasSuffix(man.Styles, ".css")) {
		return errors.New("插件样式路径无效")
	}
	if len(man.Capabilities) > 64 || len(man.ActivationEvents) > 64 || len(man.Commands) > 128 {
		return errors.New("插件声明过多")
	}
	ids := map[string]bool{}
	for _, c := range man.Commands {
		if !validID(c.ID) || strings.TrimSpace(c.Title) == "" || len(c.Title) > 120 || ids[c.ID] {
			return errors.New("插件命令声明无效或重复")
		}
		ids[c.ID] = true
	}
	return nil
}
func (m *Manager) readArchive(raw []byte) (archive, error) {
	var result archive
	if len(raw) > MaxPackageBytes {
		return result, errors.New("插件 ZIP 不能超过 16 MiB")
	}
	z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return result, errors.New("插件不是有效的 ZIP 文件")
	}
	if len(z.File) > MaxFiles {
		return result, errors.New("插件文件数量超过 512")
	}
	manifestName := ""
	seenPaths := map[string]bool{}
	var total uint64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !safePath(name) || f.Mode()&os.ModeSymlink != 0 || (!f.FileInfo().IsDir() && !f.Mode().IsRegular()) {
			return result, fmt.Errorf("不安全的插件路径: %s", f.Name)
		}
		// File systems on Windows and typical macOS installations are case-insensitive.
		// Check directories as well as files, before any filesystem writes occur.
		folded := strings.ToLower(name)
		if seenPaths[folded] {
			return result, errors.New("插件 ZIP 包含大小写冲突或重复路径")
		}
		seenPaths[folded] = true
		if f.UncompressedSize64 > MaxExpandedBytes || total > MaxExpandedBytes-f.UncompressedSize64 {
			return result, errors.New("插件解压大小超过 32 MiB")
		}
		total += f.UncompressedSize64
		if path.Base(f.Name) == "manifest.json" && !f.FileInfo().IsDir() && (strings.Count(f.Name, "/") <= 1) {
			if manifestName != "" {
				return result, errors.New("插件包含多个清单")
			}
			manifestName = f.Name
		}
	}
	if manifestName == "" {
		return result, errors.New("ZIP 根目录或单层目录中缺少 manifest.json")
	}
	prefix := strings.TrimSuffix(manifestName, "manifest.json")
	result.files = map[string][]byte{}
	var actual uint64
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !strings.HasPrefix(f.Name, prefix) {
			return result, errors.New("插件包包含根目录之外的文件")
		}
		name := strings.TrimPrefix(f.Name, prefix)
		if !safePath(name) {
			return result, errors.New("插件文件路径无效")
		}
		if _, exists := result.files[name]; exists {
			return result, errors.New("插件 ZIP 包含重复文件")
		}
		r, err := f.Open()
		if err != nil {
			return result, err
		}
		data, readErr := io.ReadAll(io.LimitReader(r, MaxExpandedBytes+1))
		closeErr := r.Close()
		if readErr != nil {
			return result, readErr
		}
		if closeErr != nil {
			return result, closeErr
		}
		actual += uint64(len(data))
		if actual > MaxExpandedBytes {
			return result, errors.New("插件解压大小超过限制")
		}
		result.files[name] = data
	}
	manifestRaw := result.files["manifest.json"]
	if len(manifestRaw) > 64<<10 {
		return result, errors.New("插件清单过大")
	}
	if err = json.Unmarshal(manifestRaw, &result.preview.Manifest); err != nil {
		return result, errors.New("manifest.json 格式不正确")
	}
	if err = m.validate(result.preview.Manifest); err != nil {
		return result, err
	}
	if _, ok := result.files[result.preview.Manifest.Entry]; !ok {
		return result, errors.New("插件入口文件不存在")
	}
	if css := result.preview.Manifest.Styles; css != "" {
		if _, ok := result.files[css]; !ok {
			return result, errors.New("插件样式文件不存在")
		}
	}
	// Identify extracted contents, independent of ZIP entry order, timestamps and compression.
	names := make([]string, 0, len(result.files))
	for name := range result.files {
		names = append(names, name)
	}
	sort.Strings(names)
	hash := sha256.New()
	for _, name := range names {
		fmt.Fprintf(hash, "%d:", len(name))
		hash.Write([]byte(name))
		fmt.Fprintf(hash, "%d:", len(result.files[name]))
		hash.Write(result.files[name])
	}
	result.preview.Digest = hex.EncodeToString(hash.Sum(nil))
	result.preview.Files = len(result.files)
	result.preview.ExpandedBytes = actual
	return result, nil
}
func cloneRecord(r Record) Record {
	if r.Manifest.Locales != nil {
		locales := make(map[string]map[string]string, len(r.Manifest.Locales))
		for locale, dictionary := range r.Manifest.Locales {
			copy := make(map[string]string, len(dictionary))
			for key, value := range dictionary {
				copy[key] = value
			}
			locales[locale] = copy
		}
		r.Manifest.Locales = locales
	}

	r.Manifest.Capabilities = append([]string{}, r.Manifest.Capabilities...)
	r.Manifest.ActivationEvents = append([]string{}, r.Manifest.ActivationEvents...)
	r.Manifest.Commands = append([]Command{}, r.Manifest.Commands...)
	return r
}
func (m *Manager) Preview(raw []byte) (Preview, error) {
	a, err := m.readArchive(raw)
	if err != nil {
		return Preview{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a.preview.Action = "install"
	if old, ok := m.records[a.preview.Manifest.ID]; ok {
		copy := cloneRecord(old)
		a.preview.Replaces = &copy
		switch {
		case old.Digest == a.preview.Digest:
			a.preview.Action = "identical"
		case old.Manifest.Version == a.preview.Manifest.Version:
			a.preview.Action = "replace"
		case compatible(a.preview.Manifest.Version, old.Manifest.Version):
			a.preview.Action = "upgrade"
		default:
			a.preview.Action = "downgrade"
		}
	}
	for id, old := range m.records {
		if id != a.preview.Manifest.ID && strings.EqualFold(strings.TrimSpace(old.Manifest.Name), strings.TrimSpace(a.preview.Manifest.Name)) {
			a.preview.SameName = append(a.preview.SameName, cloneRecord(old))
		}
	}
	sort.Slice(a.preview.SameName, func(i, j int) bool { return a.preview.SameName[i].Manifest.ID < a.preview.SameName[j].Manifest.ID })
	return a.preview, nil
}
func (m *Manager) List() []Record {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Record, 0, len(m.records))
	for _, r := range m.records {
		out = append(out, cloneRecord(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Manifest.ID < out[j].Manifest.ID })
	return out
}
func writeAtomic(file string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".write-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), file)
}
func (m *Manager) persist() error {
	raw, err := json.MarshalIndent(m.records, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(m.root, "_state.json"), raw)
}
func (m *Manager) Install(raw []byte) (Record, error) { return m.install(raw, nil) }

// InstallApproved checks the version the user reviewed while holding the install lock.
// An empty expected digest means that the ID must not yet be installed.
func (m *Manager) InstallApproved(raw []byte, expectedDigest string) (Record, error) {
	return m.install(raw, &expectedDigest)
}
func (m *Manager) install(raw []byte, expectedDigest *string) (Record, error) {
	a, err := m.readArchive(raw)
	if err != nil {
		return Record{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	oldRecord, exists := m.records[a.preview.Manifest.ID]
	if expectedDigest != nil && ((exists && oldRecord.Digest != *expectedDigest) || (!exists && *expectedDigest != "")) {
		return Record{}, ErrInstallChanged
	}
	if exists && oldRecord.Digest == a.preview.Digest {
		return cloneRecord(oldRecord), nil
	}
	if exists && oldRecord.Manifest.Version == a.preview.Manifest.Version && expectedDigest == nil {
		return Record{}, errors.New("同一插件版本已安装且内容不同，请确认替换后重新安装")
	}
	stage, err := os.MkdirTemp(m.root, ".install-")
	if err != nil {
		return Record{}, err
	}
	defer os.RemoveAll(stage)
	for name, data := range a.files {
		target := filepath.Join(stage, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return Record{}, err
		}
		if err = os.WriteFile(target, data, 0600); err != nil {
			return Record{}, err
		}
	}
	man := a.preview.Manifest
	parent := filepath.Join(m.root, man.ID)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return Record{}, err
	}
	target := filepath.Join(parent, man.Version)
	backup := target + ".previous"
	if _, err = os.Stat(target); err == nil {
		if err = os.RemoveAll(backup); err != nil {
			return Record{}, err
		}
		if err = os.Rename(target, backup); err != nil {
			return Record{}, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Record{}, err
	}
	restore := func() { os.RemoveAll(target); os.Rename(backup, target) }
	if err = os.Rename(stage, target); err != nil {
		os.Rename(backup, target)
		return Record{}, err
	}
	old, hadOld := m.records[man.ID]
	rec := Record{Manifest: man, InstalledAt: time.Now().UTC(), Digest: a.preview.Digest}
	m.records[man.ID] = rec
	if err = m.persist(); err != nil {
		if hadOld {
			m.records[man.ID] = old
		} else {
			delete(m.records, man.ID)
		}
		restore()
		return Record{}, err
	}
	os.RemoveAll(backup)
	if hadOld && old.Manifest.Version != man.Version {
		os.RemoveAll(filepath.Join(parent, old.Manifest.Version))
	}
	return cloneRecord(rec), nil
}
func (m *Manager) SetEnabled(id string, enabled bool) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	if enabled {
		if err := m.validate(r.Manifest); err != nil {
			return Record{}, err
		}
		if _, err := os.Stat(filepath.Join(m.root, id, r.Manifest.Version, r.Manifest.Entry)); err != nil {
			return Record{}, err
		}
	}
	old := r
	r.Enabled = enabled
	m.records[id] = r
	if err := m.persist(); err != nil {
		m.records[id] = old
		return Record{}, err
	}
	return cloneRecord(r), nil
}
func (m *Manager) DisableAll() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := map[string]Record{}
	for id, r := range m.records {
		old[id] = r
		r.Enabled = false
		m.records[id] = r
	}
	if err := m.persist(); err != nil {
		m.records = old
		return err
	}
	return nil
}
func (m *Manager) Uninstall(id string, deleteData bool) error {
	m.conversationIO.Lock()
	defer m.conversationIO.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok {
		return ErrNotFound
	}
	delete(m.records, id)
	if err := m.persist(); err != nil {
		m.records[id] = r
		return err
	}
	if err := os.RemoveAll(filepath.Join(m.root, id)); err != nil {
		return err
	}
	if deleteData {
		if err := os.RemoveAll(filepath.Join(m.root, "_data", id)); err != nil {
			return err
		}
		if err := os.Remove(filepath.Join(m.root, "_data", id+".json")); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
func (m *Manager) dataLocked(id string) (json.RawMessage, error) {
	if _, ok := m.records[id]; !ok {
		return nil, ErrNotFound
	}
	raw, err := os.ReadFile(filepath.Join(m.root, "_data", id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return json.RawMessage(`{}`), nil
	}
	return raw, err
}
func dataRevision(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
func (m *Manager) Data(id string) (json.RawMessage, error) {
	raw, _, err := m.DataSnapshot(id)
	return raw, err
}
func (m *Manager) DataSnapshot(id string) (json.RawMessage, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, err := m.dataLocked(id)
	if err != nil {
		return nil, "", err
	}
	return raw, dataRevision(raw), nil
}
func (m *Manager) PutData(id string, raw json.RawMessage) error {
	return m.PutDataIfRevision(id, raw, nil)
}
func (m *Manager) PutDataIfRevision(id string, raw json.RawMessage, expected *string) error {
	if len(raw) > MaxDataBytes {
		return errors.New("插件配置不能超过 256 KiB")
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return errors.New("插件配置必须为 JSON 对象")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	current, err := m.dataLocked(id)
	if err != nil {
		return err
	}
	if expected != nil && *expected != dataRevision(current) {
		return ErrDataChanged
	}
	return writeAtomic(filepath.Join(m.root, "_data", id+".json"), raw)
}
func (m *Manager) Asset(id, version, name string) (*os.File, error) {
	version, digest, qualified := strings.Cut(version, "@")
	if !validID(id) || !versionPattern.MatchString(version) || !safePath(name) {
		return nil, ErrNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok || !r.Enabled || r.Manifest.Version != version || (qualified && digest != r.Digest) {
		return nil, ErrNotFound
	}
	base := filepath.Join(m.root, id, version)
	base, err := filepath.EvalSymlinks(base)
	if err != nil {
		return nil, err
	}
	target := filepath.Join(base, filepath.FromSlash(name))
	// Reject a local filesystem symlink as well as ZIP symlinks.
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		return nil, err
	}
	rel, err := filepath.Rel(base, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return nil, ErrNotFound
	}
	f, err := os.Open(resolved)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, ErrNotFound
	}
	return f, nil
}
