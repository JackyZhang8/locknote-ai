package plugins

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestConversationRestartAndPaging(t *testing.T) {
	root := t.TempDir()
	m, _ := New(root, "0.1.0")
	rec, err := m.Install(packageZIP(t, sampleManifest(), nil))
	if err != nil {
		t.Fatal(err)
	}
	c, err := m.CreateConversation(rec.Manifest.ID, "First")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 40; i++ {
		if _, err = m.AppendConversation(rec.Manifest.ID, c.ID, int64(i+1), []json.RawMessage{json.RawMessage(`{"type":"message","role":"user","content":"hello"}`)}); err != nil {
			t.Fatal(err)
		}
	}
	m, _ = New(root, "0.1.0")
	list, err := m.ListConversations(rec.Manifest.ID, 0)
	if err != nil || len(list.Items) != 1 || list.ActiveID != c.ID {
		t.Fatalf("%+v %v", list, err)
	}
	page, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1)
	if err != nil || len(page.Events) == 0 || page.Before <= 0 {
		t.Fatalf("%+v %v", page, err)
	}
	if page.Seq != 41 {
		t.Fatal(page.Seq)
	}
	if _, err = m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage(`{"type":"message"}`)}); err == nil {
		t.Fatal("stale append accepted")
	}
	if err = m.RenameConversation(rec.Manifest.ID, c.ID, "Renamed"); err != nil {
		t.Fatal(err)
	}
	list, _ = m.ListConversations(rec.Manifest.ID, 0)
	if list.Items[0].Title != "Renamed" {
		t.Fatal(list)
	}
	if err = m.Uninstall(rec.Manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	m.Install(packageZIP(t, sampleManifest(), nil))
	list, _ = m.ListConversations(rec.Manifest.ID, 0)
	if len(list.Items) != 1 {
		t.Fatal("uninstall lost history")
	}
	if err = m.Uninstall(rec.Manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "_data", rec.Manifest.ID)); !os.IsNotExist(err) {
		t.Fatal("data folder retained", err)
	}
}
func TestConversationTornTailAndInvalidPaths(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "Test")
	file := filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".jsonl")
	f, _ := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0600)
	f.WriteString(`{"seq":2`)
	f.Close()
	page, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1)
	if err != nil || !page.Recovered || page.Seq != 1 {
		t.Fatalf("%+v %v", page, err)
	}
	if _, err = m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage(`{"type":"message","content":"after"}`)}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"../escape", "a/b", ""} {
		if _, err = m.ReadConversation(rec.Manifest.ID, id, -1); err == nil {
			t.Fatal("invalid id accepted", id)
		}
	}
	f, _ = os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0600)
	f.WriteString("broken\n")
	f.Close()
	if _, err = m.ReadConversation(rec.Manifest.ID, c.ID, -1); err == nil {
		t.Fatal("complete corruption silently ignored")
	}
}

func TestConversationMetadataRecoveryAndIsolation(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "One")
	old, _ := os.ReadFile(filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".meta.json"))
	if _, err := m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage("{\"type\":\"checkpoint\",\"state\":{\"history\":[]}}")}); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".meta.json"), old, 0600)
	if _, err := m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage("{\"type\":\"message\"}")}); err != ErrConversationChanged {
		t.Fatal("stale metadata accepted", err)
	}
	page, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1)
	if err != nil || page.Seq != 2 || len(page.Checkpoint) == 0 {
		t.Fatal(page, err)
	}
	other := sampleManifest()
	other.ID = "example.other"
	m.Install(packageZIP(t, other, nil))
	if _, err = m.ReadConversation(other.ID, c.ID, -1); err == nil {
		t.Fatal("other plugin read history")
	}
	if _, err = m.AppendConversation(rec.Manifest.ID, c.ID, 2, []json.RawMessage{json.RawMessage("{\"type\":\"unknown\"}")}); err == nil {
		t.Fatal("unknown event accepted")
	}
	before, _ := os.ReadFile(filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".jsonl"))
	if _, err = m.AppendConversation(rec.Manifest.ID, c.ID, 2, []json.RawMessage{json.RawMessage("{\"type\":\"message\"}"), json.RawMessage("invalid")}); err == nil {
		t.Fatal("bad batch accepted")
	}
	after, _ := os.ReadFile(filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".jsonl"))
	if string(before) != string(after) {
		t.Fatal("failed batch partially committed")
	}
}
func TestConversationRejectsSymlink(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "One")
	file := filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".jsonl")
	os.Remove(file)
	outside := filepath.Join(t.TempDir(), "outside")
	os.WriteFile(outside, []byte("private"), 0600)
	if err := os.Symlink(outside, file); err != nil {
		t.Skip(err)
	}
	if _, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1); err == nil {
		t.Fatal("symlink read")
	}
	if _, err := m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage("{\"type\":\"message\"}")}); err == nil {
		t.Fatal("symlink write")
	}
}

func TestConversationConcurrentWritesAndPages(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "Concurrent")
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage("{\"type\":\"message\",\"role\":\"user\",\"content\":\"once\"}")})
			results <- err
		}()
	}
	success, conflict := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			success++
		} else if err == ErrConversationChanged {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal(success, conflict)
	}
	for i := int64(2); i < 80; i++ {
		_, err := m.AppendConversation(rec.Manifest.ID, c.ID, i, []json.RawMessage{json.RawMessage("{\"type\":\"message\",\"content\":\"next\"}")})
		if err != nil {
			t.Fatal(err)
		}
	}
	before := int64(-1)
	seen := map[int64]bool{}
	for {
		page, err := m.ReadConversation(rec.Manifest.ID, c.ID, before)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Events) > 32 {
			t.Fatal("unbounded read")
		}
		for _, raw := range page.Events {
			var event struct{ Seq int64 }
			json.Unmarshal(raw, &event)
			if seen[event.Seq] {
				t.Fatal("duplicate page", event.Seq)
			}
			seen[event.Seq] = true
		}
		if page.Before == 0 {
			break
		}
		before = page.Before
	}
	if len(seen) != 80 {
		t.Fatal(len(seen))
	}
}

func TestConversationBrokenMetadataDoesNotBlockHealthyHistory(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	healthy, _ := m.CreateConversation(rec.Manifest.ID, "Healthy")
	broken, _ := m.CreateConversation(rec.Manifest.ID, "Rebuild")
	dir := filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations")
	os.WriteFile(filepath.Join(dir, broken.ID+".meta.json"), []byte("invalid"), 0600)
	list, err := m.ListConversations(rec.Manifest.ID, 0)
	if err != nil || len(list.Items) != 2 {
		t.Fatalf("metadata rebuild: %+v %v", list, err)
	}
	os.WriteFile(filepath.Join(dir, broken.ID+".meta.json"), []byte("invalid"), 0600)
	os.WriteFile(filepath.Join(dir, broken.ID+".jsonl"), []byte("invalid\n"), 0600)
	list, err = m.ListConversations(rec.Manifest.ID, 0)
	if err != nil || len(list.Items) != 1 || list.Items[0].ID != healthy.ID {
		t.Fatalf("fault isolation: %+v %v", list, err)
	}
	raw, _ := json.Marshal(list)
	if !strings.Contains(string(raw), "warnings") {
		t.Fatal("corruption not reported")
	}
}
func TestConversationIndexRebuild(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "Indexed")
	index := filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".idx")
	if _, err := os.Stat(index); err != nil {
		t.Fatal("missing offset index", err)
	}
	for i := int64(1); i < 70; i++ {
		if _, err := m.AppendConversation(rec.Manifest.ID, c.ID, i, []json.RawMessage{json.RawMessage("{\"type\":\"message\",\"content\":\"hello\"}")}); err != nil {
			t.Fatal(err)
		}
	}
	os.Remove(index)
	page, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1)
	if err != nil || page.Seq != 70 {
		t.Fatal(page, err)
	}
	if info, err := os.Stat(index); err != nil || info.Size() != 70*16 {
		t.Fatal("bad rebuilt index", info, err)
	}
	os.WriteFile(index, []byte("bad index"), 0600)
	page, err = m.ReadConversation(rec.Manifest.ID, c.ID, 40)
	if err != nil || page.Before != 8 {
		t.Fatal(page, err)
	}
}

func TestConversationReadDoesNotHoldManagementLock(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "Lock")
	value, _ := m.conversationLocks.LoadOrStore(rec.Manifest.ID+":"+c.ID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	done := make(chan error, 1)
	go func() { _, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1); done <- err }()
	// Holding a conversation lock must never retain the manager mutex while waiting.
	listed := make(chan bool, 1)
	go func() {
		for i := 0; i < 10; i++ {
			m.List()
		}
		listed <- true
	}()
	select {
	case <-listed:
	case <-time.After(time.Second):
		lock.Unlock()
		t.Fatal("conversation I/O blocked plugin manager")
	}
	lock.Unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestConversationIndexChecksumAndMissingMetadata(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "Integrity")
	dir := filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations")
	idx := filepath.Join(dir, c.ID+".idx")
	raw, _ := os.ReadFile(idx)
	raw[12] ^= 0xff
	os.WriteFile(idx, raw, 0600)
	if _, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1); err != nil {
		t.Fatal("derived index did not rebuild", err)
	}
	os.Remove(filepath.Join(dir, c.ID+".meta.json"))
	list, err := m.ListConversations(rec.Manifest.ID, 0)
	if err != nil || len(list.Items) != 1 || list.Items[0].Title != "Integrity" {
		t.Fatal(list, err)
	}
	if err = m.DeleteConversation(rec.Manifest.ID, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(idx); !os.IsNotExist(err) {
		t.Fatal("delete retained index", err)
	}
}

func TestConversationIndexedReadsKeepCheckpointAndDoNotRewriteMetadata(t *testing.T) {
	m, _ := New(t.TempDir(), "0.1.0")
	rec, _ := m.Install(packageZIP(t, sampleManifest(), nil))
	c, _ := m.CreateConversation(rec.Manifest.ID, "Checkpoint")
	c, err := m.AppendConversation(rec.Manifest.ID, c.ID, 1, []json.RawMessage{json.RawMessage("{\"type\":\"checkpoint\",\"state\":{\"v\":1}}")})
	if err != nil {
		t.Fatal(err)
	}
	for i := int64(2); i < 40; i++ {
		if _, err = m.AppendConversation(rec.Manifest.ID, c.ID, i, []json.RawMessage{json.RawMessage("{\"type\":\"message\"}")}); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(m.root, "_data", rec.Manifest.ID, "conversations", c.ID+".meta.json")
	stamp := time.Unix(100000, 0)
	os.Chtimes(file, stamp, stamp)
	page, err := m.ReadConversation(rec.Manifest.ID, c.ID, -1)
	if err != nil || len(page.Checkpoint) == 0 || page.CheckpointSeq != 2 {
		t.Fatal(page, err)
	}
	info, err := os.Stat(file)
	if err != nil || !info.ModTime().Equal(stamp) {
		t.Fatal("unchanged metadata rewritten", info, err)
	}
}
