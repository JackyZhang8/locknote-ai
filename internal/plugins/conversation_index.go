package plugins

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"os"
	"strings"
)

func validConversationIndex(file string, c Conversation) bool {
	data, e := os.Stat(file)
	if e != nil || data.Size() != c.Size {
		return false
	}
	index, e := os.Lstat(strings.TrimSuffix(file, ".jsonl") + ".idx")
	return e == nil && index.Mode().IsRegular() && index.Size() == c.Seq*16 && !data.ModTime().After(index.ModTime())
}
func indexedConversation(file string, c Conversation, before int64) (ConversationPage, error) {
	if !validConversationIndex(file, c) {
		return scanConversation(file, c, before)
	}
	out, err := readConversationIndex(file, c, before)
	if err != nil {
		return scanConversation(file, c, before)
	}
	return out, nil
}
func readConversationIndex(file string, c Conversation, before int64) (ConversationPage, error) {
	out := ConversationPage{Conversation: c, Events: []json.RawMessage{}}
	data, err := os.Open(file)
	if err != nil {
		return out, err
	}
	defer data.Close()
	index, err := os.Open(strings.TrimSuffix(file, ".jsonl") + ".idx")
	if err != nil {
		return out, err
	}
	defer index.Close()
	read := func(seq int64) (json.RawMessage, error) {
		if seq < 1 || seq > c.Seq {
			return nil, errors.New("invalid index sequence")
		}
		var slot [16]byte
		if _, e := index.ReadAt(slot[:], (seq-1)*16); e != nil {
			return nil, e
		}
		offset := int64(binary.LittleEndian.Uint64(slot[:8]))
		length := int64(binary.LittleEndian.Uint32(slot[8:12]))
		if offset < 0 || length < 2 || length > MaxConversationEvent || offset > c.Size-length {
			return nil, errors.New("invalid offset index")
		}
		raw := make([]byte, length)
		if _, e := data.ReadAt(raw, offset); e != nil {
			return nil, e
		}
		if crc32.ChecksumIEEE(raw) != binary.LittleEndian.Uint32(slot[12:]) || raw[len(raw)-1] != 10 {
			return nil, errors.New("index checksum mismatch")
		}
		var header struct{ Seq int64 }
		if json.Unmarshal(raw, &header) != nil || header.Seq != seq {
			return nil, errors.New("invalid indexed record")
		}
		return json.RawMessage(raw[:len(raw)-1]), nil
	}
	end := c.Seq
	if before >= 0 && before <= end {
		end = before - 1
	}
	if end < 1 {
		return out, nil
	}
	size := 0
	first := end
	for seq := end; seq > 0 && len(out.Events) < 32; seq-- {
		raw, e := read(seq)
		if e != nil {
			return out, e
		}
		if size+len(raw) > 3<<20 && len(out.Events) > 0 {
			break
		}
		size += len(raw)
		out.Events = append(out.Events, raw)
		first = seq
	}
	for i, j := 0, len(out.Events)-1; i < j; i, j = i+1, j-1 {
		out.Events[i], out.Events[j] = out.Events[j], out.Events[i]
	}
	if first > 1 {
		out.Before = first
	}
	if c.CheckpointSeq > 0 {
		out.Checkpoint, err = read(c.CheckpointSeq)
		if err != nil {
			return out, err
		}
	}
	return out, nil
}
