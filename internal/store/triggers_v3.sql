-- Materialised inverted lists. Every statement recomputes from the normalised
-- tables rather than applying +/- 1 deltas, so it is idempotent under FK
-- cascades, soft deletes, restores and repeated bulk rebuilds.
--
-- These triggers are installed on the real application connection. Bulk loaders
-- that write straight into SQLite (tools/stress_seed.py) drop them first, load,
-- then run rebuild_v3.sql and reinstall everything, which is far faster than
-- doing a correlated recompute per row.

DROP TRIGGER IF EXISTS trg_note_tags_insert;
CREATE TRIGGER trg_note_tags_insert AFTER INSERT ON note_tags BEGIN
    UPDATE notes SET tags_text = COALESCE((
        SELECT group_concat(t.name, ',') FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = NEW.note_id), '')
    WHERE id = NEW.note_id;

    UPDATE tags SET
        note_ids = COALESCE((
            SELECT group_concat(nt.note_id, ',') FROM note_tags nt
            JOIN notes n ON n.id = nt.note_id
            WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), ''),
        note_count = COALESCE((
            SELECT COUNT(*) FROM note_tags nt
            JOIN notes n ON n.id = nt.note_id
            WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), 0)
    WHERE id = NEW.tag_id;
END;

DROP TRIGGER IF EXISTS trg_note_tags_delete;
CREATE TRIGGER trg_note_tags_delete AFTER DELETE ON note_tags BEGIN
    UPDATE notes SET tags_text = COALESCE((
        SELECT group_concat(t.name, ',') FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = OLD.note_id), '')
    WHERE id = OLD.note_id;

    UPDATE tags SET
        note_ids = COALESCE((
            SELECT group_concat(nt.note_id, ',') FROM note_tags nt
            JOIN notes n ON n.id = nt.note_id
            WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), ''),
        note_count = COALESCE((
            SELECT COUNT(*) FROM note_tags nt
            JOIN notes n ON n.id = nt.note_id
            WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), 0)
    WHERE id = OLD.tag_id;
END;

DROP TRIGGER IF EXISTS trg_tags_rename;
CREATE TRIGGER trg_tags_rename AFTER UPDATE OF name ON tags BEGIN
    UPDATE notes SET tags_text = COALESCE((
        SELECT group_concat(t.name, ',') FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = notes.id), '')
    WHERE id IN (SELECT note_id FROM note_tags WHERE tag_id = NEW.id);
END;

DROP TRIGGER IF EXISTS trg_notes_live_change;
CREATE TRIGGER trg_notes_live_change AFTER UPDATE OF deleted_at, notebook_id ON notes BEGIN
    UPDATE tags SET
        note_ids = COALESCE((
            SELECT group_concat(nt.note_id, ',') FROM note_tags nt
            JOIN notes n ON n.id = nt.note_id
            WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), ''),
        note_count = COALESCE((
            SELECT COUNT(*) FROM note_tags nt
            JOIN notes n ON n.id = nt.note_id
            WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), 0)
    WHERE id IN (SELECT tag_id FROM note_tags WHERE note_id = NEW.id);

    UPDATE notebooks SET note_count = COALESCE((
        SELECT COUNT(*) FROM notes n
        WHERE n.notebook_id = notebooks.id AND n.deleted_at IS NULL), 0)
    WHERE id = OLD.notebook_id OR id = NEW.notebook_id;
END;

DROP TRIGGER IF EXISTS trg_notes_insert_counts;
CREATE TRIGGER trg_notes_insert_counts AFTER INSERT ON notes
WHEN NEW.deleted_at IS NULL BEGIN
    UPDATE notebooks SET note_count = COALESCE((
        SELECT COUNT(*) FROM notes n
        WHERE n.notebook_id = notebooks.id AND n.deleted_at IS NULL), 0)
    WHERE id = NEW.notebook_id;
END;

DROP TRIGGER IF EXISTS trg_notes_delete_counts;
CREATE TRIGGER trg_notes_delete_counts AFTER DELETE ON notes BEGIN
    UPDATE notebooks SET note_count = COALESCE((
        SELECT COUNT(*) FROM notes n
        WHERE n.notebook_id = notebooks.id AND n.deleted_at IS NULL), 0)
    WHERE id = OLD.notebook_id;
END;

