package plugins

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const MaxConversationEvent = 2 << 20

var ErrConversationChanged = errors.New("会话已变化，请重新打开 / conversation changed")

type Conversation struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	Seq           int64  `json:"seq"`
	Size          int64  `json:"size"`
	CheckpointSeq int64  `json:"checkpointSeq,omitempty"`
}
type ConversationList struct {
	Items    []Conversation `json:"items"`
	ActiveID string         `json:"activeId"`
	Next     int            `json:"next"`
	Warnings []string       `json:"warnings,omitempty"`
}
type ConversationPage struct {
	Conversation
	Events     []json.RawMessage `json:"events"`
	Checkpoint json.RawMessage   `json:"checkpoint,omitempty"`
	Before     int64             `json:"before"`
	Recovered  bool              `json:"recovered"`
}

func (m *Manager) conversationDir(plugin string) (string, error) {
	if _, ok := m.records[plugin]; !ok {
		return "", ErrNotFound
	}
	dir := m.root
	for _, part := range []string{"_data", plugin, "conversations"} {
		dir = filepath.Join(dir, part)
		info, err := os.Lstat(dir)
		if os.IsNotExist(err) {
			err = os.Mkdir(dir, 0700)
			if err != nil {
				return "", err
			}
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("invalid conversation directory")
		}
	}
	return dir, nil
}
func conversationFile(dir, id, suffix string) (string, error) {
	if len(id) != 32 {
		return "", errors.New("invalid conversation ID")
	}
	if _, err := hex.DecodeString(id); err != nil {
		return "", err
	}
	file := filepath.Join(dir, id+suffix)
	info, err := os.Lstat(file)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if err == nil && !info.Mode().IsRegular() {
		return "", errors.New("invalid conversation file")
	}
	return file, nil
}
func conversationMeta(dir, id string) (Conversation, error) {
	var meta Conversation
	file, err := conversationFile(dir, id, ".meta.json")
	if err != nil {
		return meta, err
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return meta, err
	}
	err = json.Unmarshal(raw, &meta)
	if err == nil && meta.ID != id {
		err = errors.New("invalid conversation metadata")
	}
	return meta, err
}
func saveConversationMeta(dir string, c Conversation) error {
	file, err := conversationFile(dir, c.ID, ".meta.json")
	if err != nil {
		return err
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return writeAtomic(file, raw)
}
func activeConversation(dir string) string {
	raw, _ := os.ReadFile(filepath.Join(dir, "active.json"))
	var id string
	json.Unmarshal(raw, &id)
	return id
}
func setActiveConversation(dir, id string) error {
	raw, _ := json.Marshal(id)
	return writeAtomic(filepath.Join(dir, "active.json"), raw)
}

// Lock order: lifecycle read gate, brief manager lookup, then conversation lock.
// Uninstall takes the lifecycle write gate before touching plugin data.
func (m *Manager) lockConversation(plugin, id string) (string, func(), error) {
	m.conversationIO.RLock()
	m.mu.Lock()
	dir, err := m.conversationDir(plugin)
	m.mu.Unlock()
	if err != nil {
		m.conversationIO.RUnlock()
		return "", func() {}, err
	}
	value, _ := m.conversationLocks.LoadOrStore(plugin+":"+id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	return dir, func() { lock.Unlock(); m.conversationIO.RUnlock() }, nil
}
func loadConversation(dir, id string) (Conversation, error) {
	c, err := conversationMeta(dir, id)
	if err != nil {
		file, e := conversationFile(dir, id, ".jsonl")
		if e != nil {
			return c, e
		}
		page, e := scanConversation(file, Conversation{ID: id}, 0)
		if e != nil {
			return c, e
		}
		c = page.Conversation
		if c.Seq == 0 {
			return c, errors.New("empty conversation journal")
		}
		err = saveConversationMeta(dir, c)
	}
	return c, err
}
func (m *Manager) CreateConversation(plugin, title string) (Conversation, error) {
	dir, unlock, err := m.lockConversation(plugin, "new")
	defer unlock()
	if err != nil {
		return Conversation{}, err
	}
	key := make([]byte, 16)
	if _, err = rand.Read(key); err != nil {
		return Conversation{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	c := Conversation{ID: hex.EncodeToString(key), Title: strings.TrimSpace(title), CreatedAt: now, UpdatedAt: now}
	if c.Title == "" {
		c.Title = "New chat"
	}
	if len(c.Title) > 500 {
		return c, errors.New("title too long")
	}
	value, _ := m.conversationLocks.LoadOrStore(plugin+":"+c.ID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	file := filepath.Join(dir, c.ID+".jsonl")
	f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return c, err
	}
	f.Close()
	raw, _ := json.Marshal(map[string]any{"type": "session", "title": c.Title})
	c, err = m.appendConversation(dir, c, []json.RawMessage{raw})
	if err != nil {
		return c, err
	}
	err = setActiveConversation(dir, c.ID)
	return c, err
}
func (m *Manager) ListConversations(plugin string, offset int) (ConversationList, error) {
	out := ConversationList{Items: []Conversation{}, Next: -1}
	dir, unlock, err := m.lockConversation(plugin, "list")
	defer unlock()
	if err != nil {
		return out, err
	}
	out.ActiveID = activeConversation(dir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out, err
	}
	all := []Conversation{}
	seen := map[string]bool{}
	for _, entry := range entries {
		name := entry.Name()
		var id string
		if strings.HasSuffix(name, ".jsonl") {
			id = strings.TrimSuffix(name, ".jsonl")
		} else if strings.HasSuffix(name, ".meta.json") {
			id = strings.TrimSuffix(name, ".meta.json")
		} else {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		if _, e := conversationFile(dir, id, ".jsonl"); e != nil {
			out.Warnings = append(out.Warnings, fmt.Sprintf("非法会话文件 %s: %v", id, e))
			continue
		}
		value, _ := m.conversationLocks.LoadOrStore(plugin+":"+id, &sync.Mutex{})
		lock := value.(*sync.Mutex)
		lock.Lock()
		c, e := loadConversation(dir, id)
		lock.Unlock()
		if e != nil {
			out.Warnings = append(out.Warnings, fmt.Sprintf("会话 %s 无法读取，原文件保留: %v", id, e))
			continue
		}
		all = append(all, c)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].UpdatedAt > all[j].UpdatedAt })
	if offset < 0 {
		offset = 0
	}
	if offset > len(all) {
		offset = len(all)
	}
	end := min(offset+50, len(all))
	out.Items = all[offset:end]
	if end < len(all) {
		out.Next = end
	}
	return out, nil
}

// Stream the journal; keep only a bounded page and the most recent checkpoint.
func scanConversation(file string, c Conversation, before int64) (ConversationPage, error) {
	out := ConversationPage{Conversation: c, Events: []json.RawMessage{}}
	f, err := os.OpenFile(file, os.O_RDWR, 0600)
	if err != nil {
		return out, err
	}
	defer f.Close()
	index, err := os.CreateTemp(filepath.Dir(file), ".index-")
	if err != nil {
		return out, err
	}
	defer os.Remove(index.Name())
	defer index.Close()
	reader := bufio.NewReaderSize(f, 64<<10)
	var offset, seq int64
	retained := 0
	for {
		var line []byte
		for {
			piece, e := reader.ReadSlice('\n')
			line = append(line, piece...)
			if len(line) > MaxConversationEvent {
				return out, errors.New("conversation record too large")
			}
			if e == bufio.ErrBufferFull {
				continue
			}
			err = e
			break
		}
		if err == io.EOF && len(line) == 0 {
			break
		}
		if err != nil && err != io.EOF {
			return out, err
		}
		if err == io.EOF {
			if e := os.WriteFile(file+".recovered-"+fmt.Sprint(time.Now().UnixNano()), line, 0600); e != nil {
				return out, e
			}
			if e := f.Truncate(offset); e != nil {
				return out, e
			}
			if e := f.Sync(); e != nil {
				return out, e
			}
			out.Recovered = true
			break
		}
		var event struct {
			Seq   int64  `json:"seq"`
			Type  string `json:"type"`
			Title string `json:"title"`
			At    string `json:"at"`
		}
		if json.Unmarshal(line, &event) != nil || event.Seq != seq+1 || event.Type == "" {
			return out, fmt.Errorf("会话文件第 %d 条记录损坏，原文件已保留", seq+1)
		}
		seq = event.Seq
		var slot [16]byte
		binary.LittleEndian.PutUint64(slot[0:8], uint64(offset))
		binary.LittleEndian.PutUint32(slot[8:12], uint32(len(line)))
		binary.LittleEndian.PutUint32(slot[12:16], crc32.ChecksumIEEE(line))
		if _, e := index.Write(slot[:]); e != nil {
			return out, e
		}
		if seq == 1 {
			out.CreatedAt = event.At
		}
		offset += int64(len(line))
		if event.Type == "session" || event.Type == "rename" {
			out.Title = event.Title
		}
		out.UpdatedAt = event.At
		raw := json.RawMessage(bytes.TrimSpace(line))
		if event.Type == "checkpoint" {
			out.Checkpoint = append(json.RawMessage{}, raw...)
			out.CheckpointSeq = seq
		}
		if before < 0 || seq < before {
			out.Events = append(out.Events, append(json.RawMessage{}, raw...))
			retained += len(raw)
			for len(out.Events) > 32 || (retained > 3<<20 && len(out.Events) > 1) {
				retained -= len(out.Events[0])
				out.Events = out.Events[1:]
			}
		}
	}
	if e := index.Sync(); e != nil {
		return out, e
	}
	if e := index.Close(); e != nil {
		return out, e
	}
	if e := os.Rename(index.Name(), strings.TrimSuffix(file, ".jsonl")+".idx"); e != nil {
		return out, e
	}
	out.Seq = seq
	out.Size = offset
	if len(out.Events) > 0 {
		var first struct {
			Seq int64 `json:"seq"`
		}
		json.Unmarshal(out.Events[0], &first)
		if first.Seq > 1 {
			out.Before = first.Seq
		}
	}
	return out, nil
}
func (m *Manager) ReadConversation(plugin, id string, before int64) (ConversationPage, error) {
	dir, unlock, err := m.lockConversation(plugin, id)
	defer unlock()
	if err != nil {
		return ConversationPage{}, err
	}
	c, err := loadConversation(dir, id)
	if err != nil {
		return ConversationPage{}, err
	}
	file, err := conversationFile(dir, id, ".jsonl")
	if err != nil {
		return ConversationPage{}, err
	}
	out, err := indexedConversation(file, c, before)
	if err == nil && out.Conversation != c {
		err = saveConversationMeta(dir, out.Conversation)
	}
	return out, err
}
func (m *Manager) appendConversation(dir string, c Conversation, events []json.RawMessage) (Conversation, error) {
	file, err := conversationFile(dir, c.ID, ".jsonl")
	if err != nil {
		return c, err
	}
	info, err := os.Stat(file)
	if err != nil {
		return c, err
	}
	if info.Size() != c.Size || !validConversationIndex(file, c) {
		page, e := scanConversation(file, c, 0)
		if e != nil {
			return c, e
		}
		c = page.Conversation
	}
	var buffer bytes.Buffer
	var indexBuffer bytes.Buffer
	next := c.Seq
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, raw := range events {
		var event map[string]json.RawMessage
		if json.Unmarshal(raw, &event) != nil || event == nil {
			return c, errors.New("invalid journal event")
		}
		var kind string
		json.Unmarshal(event["type"], &kind)
		switch kind {
		case "session", "rename", "message", "turn_start", "tool", "checkpoint":
		default:
			return c, errors.New("invalid journal event type")
		}
		next++
		event["seq"], _ = json.Marshal(next)
		event["v"] = json.RawMessage("1")
		event["at"], _ = json.Marshal(now)
		encoded, e := json.Marshal(event)
		if e != nil {
			return c, e
		}
		if len(encoded)+1 > MaxConversationEvent {
			return c, errors.New("conversation record too large")
		}
		var slot [16]byte
		binary.LittleEndian.PutUint64(slot[0:8], uint64(c.Size+int64(buffer.Len())))
		binary.LittleEndian.PutUint32(slot[8:12], uint32(len(encoded)+1))
		binary.LittleEndian.PutUint32(slot[12:16], crc32.ChecksumIEEE(append(encoded, 10)))
		indexBuffer.Write(slot[:])
		if kind == "checkpoint" {
			c.CheckpointSeq = next
		}
		buffer.Write(encoded)
		buffer.WriteByte(10)
		if kind == "session" || kind == "rename" {
			json.Unmarshal(event["title"], &c.Title)
		}
	}
	f, err := os.OpenFile(file, os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return c, err
	}
	n, err := f.Write(buffer.Bytes())
	if err == nil && n != buffer.Len() {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return c, err
	}
	if closeErr != nil {
		return c, closeErr
	}
	indexFile := strings.TrimSuffix(file, ".jsonl") + ".idx"
	idx, e := os.OpenFile(indexFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return c, e
	}
	written, e := idx.Write(indexBuffer.Bytes())
	if e == nil && written != indexBuffer.Len() {
		e = io.ErrShortWrite
	}
	if e == nil {
		e = idx.Sync()
	}
	closed := idx.Close()
	if e != nil {
		return c, e
	}
	if closed != nil {
		return c, closed
	}
	c.Seq = next
	c.Size += int64(n)
	c.UpdatedAt = now
	return c, saveConversationMeta(dir, c)
}
func (m *Manager) AppendConversation(plugin, id string, expected int64, events []json.RawMessage) (Conversation, error) {
	dir, unlock, err := m.lockConversation(plugin, id)
	defer unlock()
	if err != nil {
		return Conversation{}, err
	}
	c, err := loadConversation(dir, id)
	if err != nil {
		return c, err
	}
	file, err := conversationFile(dir, id, ".jsonl")
	if err != nil {
		return c, err
	}
	info, err := os.Stat(file)
	if err != nil {
		return c, err
	}
	if info.Size() != c.Size || !validConversationIndex(file, c) {
		page, e := scanConversation(file, c, 0)
		if e != nil {
			return c, e
		}
		c = page.Conversation
	}
	if c.Seq != expected {
		return c, ErrConversationChanged
	}
	if len(events) == 0 || len(events) > 16 {
		return c, errors.New("invalid journal batch")
	}
	return m.appendConversation(dir, c, events)
}
func (m *Manager) ActivateConversation(plugin, id string) error {
	dir, unlock, err := m.lockConversation(plugin, "active")
	defer unlock()
	if err != nil {
		return err
	}
	if id != "" {
		if _, err = loadConversation(dir, id); err != nil {
			return err
		}
	}
	return setActiveConversation(dir, id)
}
func (m *Manager) RenameConversation(plugin, id, title string) error {
	title = strings.TrimSpace(title)
	if title == "" || len(title) > 500 {
		return errors.New("invalid title")
	}
	dir, unlock, err := m.lockConversation(plugin, id)
	defer unlock()
	if err != nil {
		return err
	}
	c, err := loadConversation(dir, id)
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(map[string]string{"type": "rename", "title": title})
	_, err = m.appendConversation(dir, c, []json.RawMessage{raw})
	return err
}
func (m *Manager) DeleteConversation(plugin, id string) error {
	dir, unlock, err := m.lockConversation(plugin, id)
	defer unlock()
	if err != nil {
		return err
	}
	if _, err = loadConversation(dir, id); err != nil {
		return err
	}
	for _, suffix := range []string{".jsonl", ".idx", ".meta.json"} {
		file, e := conversationFile(dir, id, suffix)
		if e != nil {
			return e
		}
		if e = os.Remove(file); e != nil && !os.IsNotExist(e) {
			return e
		}
	}
	backups, err := filepath.Glob(filepath.Join(dir, id+".jsonl.recovered-*"))
	if err != nil {
		return err
	}
	for _, backup := range backups {
		if err = os.Remove(backup); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if activeConversation(dir) == id {
		return setActiveConversation(dir, "")
	}
	return nil
}
