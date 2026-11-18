package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Maintenance avoids migrations, seeding and implicit index repair.
func openMaintenance(path string) (*Store, error) {
	if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
		return nil, fmt.Errorf("database does not exist: %s", path)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err = db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	st := &Store{db: db, path: path}
	var count int
	if err = db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='notes_fts'").Scan(&count); err != nil {
		db.Close()
		return nil, err
	}
	st.ftsEnabled = count > 0
	return st, nil
}

// Stop the application and other database writers before maintenance.
func MaintainDatabase(path string, repair bool) (string, error) {
	st, err := openMaintenance(path)
	if err != nil {
		return "", err
	}
	defer st.Close()
	if repair {
		return st.RepairIndexesWithBackup()
	}
	return "", st.CheckDatabase()
}
func (s *Store) CheckDatabase() error {
	rows, err := s.db.Query("PRAGMA integrity_check")
	if err != nil {
		return err
	}
	var problems []string
	for rows.Next() {
		var message string
		if err = rows.Scan(&message); err != nil {
			rows.Close()
			return err
		}
		if message != "ok" {
			problems = append(problems, message)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	rows, err = s.db.Query("PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	bad := rows.Next()
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if bad {
		return errors.New("foreign key integrity failed")
	}
	if !s.ftsEnabled {
		return errors.New("full-text index is missing")
	}
	if _, err = s.db.Exec("INSERT INTO notes_fts(notes_fts,rank) VALUES('integrity-check',1)"); err != nil {
		return fmt.Errorf("full-text integrity failed: %w", err)
	}
	return nil
}
func (s *Store) RepairIndexesWithBackup() (string, error) {
	backup := filepath.Join(filepath.Dir(s.path), filepath.Base(s.path)+".backup-"+time.Now().UTC().Format("20060102T150405.000000000"))
	file, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	file.Close()
	// VACUUM INTO includes committed WAL pages in a consistent SQLite snapshot.
	if _, err = s.db.Exec("VACUUM INTO ?", backup); err != nil {
		return backup, fmt.Errorf("backup failed; repair not started: %w", err)
	}
	if _, err = s.db.Exec(ftsSchemaSQL); err != nil {
		return backup, err
	}
	s.ftsEnabled = true
	if err = s.RebuildIndexes(); err != nil {
		return backup, err
	}
	return backup, s.CheckDatabase()
}
