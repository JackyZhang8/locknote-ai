-- Every table has at least one index. The notes table gets a covering index
-- for each sort/filter combination the UI uses, so deep OFFSET and ORDER BY
-- no longer sort 30k rows in memory.
-- idx_note_tags_reverse is the actual inverted index: tag -> notes in O(log n).

CREATE INDEX IF NOT EXISTS idx_notes_updated
    ON notes(deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_notebook
    ON notes(notebook_id);
CREATE INDEX IF NOT EXISTS idx_notes_external
    ON notes(external_id);
CREATE INDEX IF NOT EXISTS idx_notes_list
    ON notes(deleted_at, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_created
    ON notes(deleted_at, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_words
    ON notes(deleted_at, pinned DESC, word_count DESC);
CREATE INDEX IF NOT EXISTS idx_notes_title_sort
    ON notes(deleted_at, pinned DESC, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_notes_trash
    ON notes(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_notebook_list
    ON notes(notebook_id, deleted_at, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_source
    ON notes(source, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_external_live
    ON notes(external_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_title_lower
    ON notes(lower(title));
CREATE INDEX IF NOT EXISTS idx_notes_tags_text
    ON notes(tags_text);
-- Covering index for GetStats: the SUM(CASE ...) aggregate can be answered
-- without reading the (large) note bodies from table pages.
CREATE INDEX IF NOT EXISTS idx_notes_stats
    ON notes(deleted_at, pinned, source, word_count, updated_at);

CREATE INDEX IF NOT EXISTS idx_tags_name_lower
    ON tags(lower(name));
CREATE INDEX IF NOT EXISTS idx_tags_order
    ON tags(pinned DESC, note_count DESC, name);

CREATE INDEX IF NOT EXISTS idx_note_tags_reverse
    ON note_tags(tag_id, note_id);

CREATE INDEX IF NOT EXISTS idx_notebooks_name_lower
    ON notebooks(lower(name));
CREATE INDEX IF NOT EXISTS idx_notebooks_order
    ON notebooks(pinned DESC, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_revisions_note
    ON note_revisions(note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_created
    ON note_revisions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_created
    ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_kind
    ON activity(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_note
    ON activity(note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tokens_created
    ON api_tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_prefix
    ON api_tokens(prefix);
