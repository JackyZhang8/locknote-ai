-- Keep the trigram index in sync with notes. The 'delete' command is FTS5's
-- external-content protocol: it removes the old posting list using the OLD
-- column values, so it must run before the new row is inserted.

DROP TRIGGER IF EXISTS trg_notes_fts_insert;
CREATE TRIGGER trg_notes_fts_insert AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content, tags_text)
    VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags_text);
END;

DROP TRIGGER IF EXISTS trg_notes_fts_delete;
CREATE TRIGGER trg_notes_fts_delete AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content, tags_text)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags_text);
END;

DROP TRIGGER IF EXISTS trg_notes_fts_update;
CREATE TRIGGER trg_notes_fts_update AFTER UPDATE OF title, content, tags_text ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content, tags_text)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.tags_text);
    INSERT INTO notes_fts(rowid, title, content, tags_text)
    VALUES (NEW.rowid, NEW.title, NEW.content, NEW.tags_text);
END;
