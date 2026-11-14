package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestApplicationVersionUsesCanonicalFile(t *testing.T) {
	data, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.TrimSpace(string(data))
	if !regexp.MustCompile(`^v\d+\.\d+\.\d+$`).MatchString(want) {
		t.Fatalf("invalid release version %q", want)
	}
	if version != want {
		t.Fatalf("application version = %q, VERSION = %q", version, want)
	}
}
