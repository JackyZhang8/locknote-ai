package startup

import (
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var mu sync.Mutex
var began = time.Now()
var output io.Writer = io.Discard
var file *os.File
var frontendSeen = map[string]bool{}

func Init(dir string) error {
	mu.Lock()
	defer mu.Unlock()
	f, err := os.OpenFile(filepath.Join(dir, "startup.log"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if file != nil {
		file.Close()
	}
	file = f
	frontendSeen = map[string]bool{}
	output = f
	fmt.Fprintln(output, "[STARTUP] startup.begin 0ms")
	return nil
}
func Close() {
	mu.Lock()
	defer mu.Unlock()
	if file != nil {
		file.Close()
		file = nil
	}
	output = io.Discard
}
func Stage(name string) func() {
	start := time.Now()
	return func() { record(name, time.Since(start)) }
}
func Mark(name string) { record(name, time.Since(began)) }
func record(name string, duration time.Duration) {
	mu.Lock()
	defer mu.Unlock()
	fmt.Fprintf(output, "[STARTUP] %s %.3fms\n", name, float64(duration.Microseconds())/1000)
}
func Frontend(name string, milliseconds float64) {
	switch name {
	case "frontend.entry", "frontend.react.mount", "frontend.app.ready", "frontend.workspace.start", "frontend.workspace.data", "frontend.first.interactive":
	default:
		return
	}
	if math.IsNaN(milliseconds) || math.IsInf(milliseconds, 0) || milliseconds < 0 || milliseconds > 3600000 {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if frontendSeen[name] {
		return
	}
	frontendSeen[name] = true
	fmt.Fprintf(output, "[FRONTEND] %s %.3fms\n", name, milliseconds)
}
