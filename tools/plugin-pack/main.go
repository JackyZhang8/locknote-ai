// Command plugin-pack builds a validated, self-contained Locknote AI plugin ZIP.
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"locknote-mcp/internal/plugins"
)

func main() {
	dir := flag.String("dir", "", "plugin source directory")
	out := flag.String("out", "dist/plugins", "output directory")
	flag.Parse()
	name, err := pack(*dir, *out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(name)
}

func pack(source, output string) (string, error) {
	if source == "" {
		return "", fmt.Errorf("specify -dir")
	}
	root, err := filepath.Abs(source)
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return "", err
	}
	var manifest plugins.Manifest
	if err = json.Unmarshal(raw, &manifest); err != nil {
		return "", err
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	var expanded int64
	files := 0
	err = filepath.WalkDir(root, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("plugin contains non-regular file: %s", name)
		}
		expanded += info.Size()
		files++
		if expanded > plugins.MaxExpandedBytes || files > plugins.MaxFiles {
			return fmt.Errorf("plugin package exceeds file/size limits")
		}
		relative, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		header := &zip.FileHeader{Name: filepath.ToSlash(relative), Method: zip.Deflate, Modified: time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)}
		header.SetMode(0644)
		target, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		file, err := os.Open(name)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(target, io.LimitReader(file, plugins.MaxExpandedBytes+1))
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if err != nil {
		_ = writer.Close()
		return "", err
	}
	if err = writer.Close(); err != nil {
		return "", err
	}
	if archive.Len() > plugins.MaxPackageBytes {
		return "", fmt.Errorf("compressed package exceeds 16 MiB")
	}
	validationDir, err := os.MkdirTemp("", "locknote-plugin-validate-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(validationDir)
	manager, err := plugins.New(validationDir, manifest.MinAppVersion)
	if err != nil {
		return "", err
	}
	if _, err = manager.Preview(archive.Bytes()); err != nil {
		return "", err
	}
	if err = os.MkdirAll(output, 0755); err != nil {
		return "", err
	}
	name := filepath.Join(output, manifest.ID+"-"+manifest.Version+".zip")
	temporary, err := os.CreateTemp(output, ".plugin-*.zip")
	if err != nil {
		return "", err
	}
	defer os.Remove(temporary.Name())
	if _, err = temporary.Write(archive.Bytes()); err != nil {
		_ = temporary.Close()
		return "", err
	}
	if err = temporary.Close(); err != nil {
		return "", err
	}
	if err = os.Rename(temporary.Name(), name); err != nil {
		return "", err
	}
	return name, nil
}
