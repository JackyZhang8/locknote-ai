-- Locknote MCP schema v3. Shared by the Go application (go:embed) and
-- tools/stress_seed.py, which writes directly into SQLite. Keep both readers
-- in sync by editing this file only.
--
-- v3 adds four materialised columns: notes.tags_text ("标签1,标签2,..."),
-- tags.note_ids ("id1,id2,..."), tags.note_count and notebooks.note_count.
-- They are maintained by triggers_v3.sql / rebuilt by rebuild_v3.sql.

CREATE TABLE IF NOT EXISTS notebooks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    icon        TEXT NOT NULL DEFAULT 'book',
    color       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    note_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    notebook_id TEXT REFERENCES notebooks(id) ON DELETE SET NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT 'web',
    author      TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL DEFAULT '',
    version     INTEGER NOT NULL DEFAULT 1,
    word_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    tags_text   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '',
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    note_ids   TEXT NOT NULL DEFAULT '',
    note_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS note_revisions (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT '',
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    prefix       TEXT NOT NULL DEFAULT '',
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS activity (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    tool       TEXT NOT NULL DEFAULT '',
    note_id    TEXT NOT NULL DEFAULT '',
    note_title TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    actor      TEXT NOT NULL DEFAULT 'mcp',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
