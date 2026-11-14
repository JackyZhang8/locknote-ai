package store

import (
	_ "embed"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// This file owns the v3 indexing layer. Three complementary structures live
// side by side, each with a clear job:
//
//  1. Materialised columns (the "inverted lists" visible in the DB):
//     notes.tags_text      -> "标签1,标签2,..."
//     tags.note_ids        -> "id1,id2,..."   (live notes only)
//     tags.note_count      -> live note count for the tag
//     notebooks.note_count -> live note count for the notebook
//     They are cheap to read, export and eyeball, and they feed the FTS index.
//     A comma-separated TEXT column cannot be used by a B-tree index for a
//     "contains this tag" lookup (LIKE '%,x,%' is a prefix wildcard), so it is
//     deliberately NOT the authority for filtering or for the UI's tag chips.
//
//  2. Normalised B-tree indexes (the real, queryable inverted index):
//     note_tags(tag_id, note_id)  -> tag to notes in O(log n)
//     note_tags(note_id, tag_id)  -> note to tags (the existing PK)
//     plus covering indexes for every sort/filter the UI issues.
//
//  3. notes_fts, an FTS5 trigram keyword index over title + content +
//     tags_text. Trigram is the only bundled tokenizer that supports Chinese
//     substring search. It needs >= 3 characters, so short queries fall back
//     to a LIKE scan over the materialised tags_text column.
//
// All DDL lives in *.sql files that are shared with tools/stress_seed.py, so a
// library seeded by writing straight into SQLite has exactly the same schema.
// Everything is maintained by SQLite triggers, so writes that bypass Go still
// leave the library consistent. Every trigger recomputes from the normalised
// tables rather than applying +/- 1 deltas, which makes it idempotent under FK
// cascades, soft deletes and restores.

//go:embed schema_v3.sql
var schemaSQL string

//go:embed indexes_v3.sql
var indexSQL string

//go:embed fts_v3.sql
var ftsSchemaSQL string

//go:embed triggers_v3.sql
var materialisedTriggersSQL string

//go:embed fts_triggers_v3.sql
var ftsTriggersSQL string

//go:embed rebuild_v3.sql
var rebuildStatementsSQL string

// Shared with tools/stress_seed.py: the list of triggers that must be dropped
// before a bulk load and reinstalled afterwards.
const dropTriggersSQL = `
DROP TRIGGER IF EXISTS trg_note_tags_insert;
DROP TRIGGER IF EXISTS trg_note_tags_delete;
DROP TRIGGER IF EXISTS trg_tags_rename;
DROP TRIGGER IF EXISTS trg_notes_live_change;
DROP TRIGGER IF EXISTS trg_notes_insert_counts;
DROP TRIGGER IF EXISTS trg_notes_delete_counts;
DROP TRIGGER IF EXISTS trg_notes_fts_insert;
DROP TRIGGER IF EXISTS trg_notes_fts_delete;
DROP TRIGGER IF EXISTS trg_notes_fts_update;
`

// installIndexes creates all v3 structures. It is called from migrate and is
// safe to call repeatedly. needRebuild is true when the library predates v3.
func (s *Store) installIndexes(needRebuild bool) error {
	if _, err := s.db.Exec(indexSQL); err != nil {
		return fmt.Errorf("store: create indexes: %w", err)
	}

	if _, err := s.db.Exec(ftsSchemaSQL); err != nil {
		// FTS5 is optional: search falls back to LIKE if the driver lacks it.
		s.ftsEnabled = false
	} else {
		s.ftsEnabled = true
	}

	// SQLite's ordinary integrity_check does not compare external-content FTS
	// postings with notes. A stale posting list can make subsequent writes fail
	// with SQLITE_CORRUPT_VTAB (267), even when every source row is intact.
	if s.ftsEnabled && !needRebuild {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`INSERT INTO notes_fts(notes_fts,rank) VALUES('integrity-check',1)`); err != nil {
			if _, err = tx.Exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`); err != nil {
				return fmt.Errorf("store: repair full-text index: %w", err)
			}
			if _, err = tx.Exec(`INSERT INTO notes_fts(notes_fts,rank) VALUES('integrity-check',1)`); err != nil {
				return fmt.Errorf("store: verify repaired full-text index: %w", err)
			}
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}

	if needRebuild {
		if err := s.rebuildMaterialised(); err != nil {
			return err
		}
		if s.ftsEnabled {
			if _, err := s.db.Exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`); err != nil {
				return fmt.Errorf("store: rebuild fts: %w", err)
			}
		}
	}

	if _, err := s.db.Exec(materialisedTriggersSQL); err != nil {
		return fmt.Errorf("store: install materialised triggers: %w", err)
	}
	if s.ftsEnabled {
		if _, err := s.db.Exec(ftsTriggersSQL); err != nil {
			return fmt.Errorf("store: install fts triggers: %w", err)
		}
	}
	return nil
}

// rebuildMaterialised refreshes the denormalised columns from the normalised
// tables. Triggers are temporarily removed so a 30k-row UPDATE does not fire
// per-row FTS reindexing; installIndexes / RebuildIndexes put them back.
func (s *Store) rebuildMaterialised() error {
	if _, err := s.db.Exec(dropTriggersSQL); err != nil {
		return fmt.Errorf("store: drop triggers: %w", err)
	}
	if _, err := s.db.Exec(rebuildStatementsSQL); err != nil {
		return fmt.Errorf("store: rebuild materialised columns: %w", err)
	}
	return nil
}

// RebuildIndexes recomputes all materialised columns and the FTS index, then
// reinstalls the triggers. Use it after bulk writes that bypassed the triggers,
// or to repair a library whose denormalised data drifted.
func (s *Store) RebuildIndexes() error {
	if err := s.rebuildMaterialised(); err != nil {
		return err
	}
	if s.ftsEnabled {
		if _, err := s.db.Exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`); err != nil {
			return fmt.Errorf("store: rebuild fts: %w", err)
		}
	}
	if _, err := s.db.Exec(materialisedTriggersSQL); err != nil {
		return fmt.Errorf("store: reinstall triggers: %w", err)
	}
	if s.ftsEnabled {
		if _, err := s.db.Exec(ftsTriggersSQL); err != nil {
			return fmt.Errorf("store: reinstall fts triggers: %w", err)
		}
	}
	return nil
}

// FTSReady reports whether the trigram keyword index is available.
func (s *Store) FTSReady() bool { return s.ftsEnabled }

// ftsQuery builds a safe FTS5 phrase query. Trigram tokenisation makes a quoted
// phrase equivalent to a substring match, but it needs at least three
// characters and chokes on FTS syntax characters, so callers must gate on
// ftsEligible first.
func ftsQuery(q string) string {
	return `"` + strings.ReplaceAll(q, `"`, `""`) + `"`
}

// ftsEligible reports whether q can be answered by the trigram index. Trigram
// tokenisation needs at least three characters (so 2-character Chinese words
// must fall back to LIKE), and FTS5 syntax characters would change the meaning
// of a phrase query. Everything else is a plain substring search.
func ftsEligible(q string) bool {
	if utf8.RuneCountInString(q) < 3 {
		return false
	}
	for _, r := range q {
		switch r {
		case '"', '*', ':', '^', '(', ')', '{', '}', '[', ']', '+', '-', '~', '\\':
			return false
		}
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

// splitMaterialisedTags parses a comma-separated materialised tag list. It is
// used for the raw column only; the authoritative tag set always comes from
// note_tags, because a tag name may itself contain a comma.
func splitMaterialisedTags(v string) []string {
	if v == "" {
		return []string{}
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
