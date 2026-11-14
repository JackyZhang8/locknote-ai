package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
)

// ServeStdio runs the server over stdin/stdout using newline-delimited JSON-RPC.
// This is the transport Claude Desktop and most CLI agents use when they spawn
// the binary directly. Logs must never go to stdout.
func (s *Server) ServeStdio(ctx context.Context) error {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriter(os.Stdout)
	defer func() { _ = out.Flush() }()

	sess := &SessionInfo{ID: "stdio", Transport: "stdio"}
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := readLine(in)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var req Request
		if uerr := json.Unmarshal([]byte(line), &req); uerr != nil {
			_ = enc.Encode(rpcErrorPayload(CodeParseError, "invalid JSON: %v", uerr))
			_ = out.Flush()
			continue
		}

		resp := s.Handle(ctx, &req, sess)
		if resp == nil {
			continue
		}
		if err := enc.Encode(resp); err != nil {
			return err
		}
		if err := out.Flush(); err != nil {
			return err
		}
	}
}

// readLine reads one line of arbitrary length (up to the reader's capacity
// growth) without the 64KB limit of bufio.Scanner.
func readLine(r *bufio.Reader) (string, error) {
	var b strings.Builder
	for {
		chunk, isPrefix, err := r.ReadLine()
		if err != nil {
			if b.Len() > 0 && err == io.EOF {
				return b.String(), nil
			}
			return "", err
		}
		b.Write(chunk)
		if !isPrefix {
			return b.String(), nil
		}
	}
}
