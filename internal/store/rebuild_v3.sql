-- Set-oriented rebuild of the materialised inverted lists. Run once when a
-- database is upgraded to v3, or after a bulk loader that bypassed triggers.
-- Triggers must be dropped first (see Store.rebuildMaterialised).

UPDATE notes SET tags_text = COALESCE((
    SELECT group_concat(t.name, ',') FROM note_tags nt
    JOIN tags t ON t.id = nt.tag_id
    WHERE nt.note_id = notes.id), '');

UPDATE tags SET
    note_ids = COALESCE((
        SELECT group_concat(nt.note_id, ',') FROM note_tags nt
        JOIN notes n ON n.id = nt.note_id
        WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), ''),
    note_count = COALESCE((
        SELECT COUNT(*) FROM note_tags nt
        JOIN notes n ON n.id = nt.note_id
        WHERE nt.tag_id = tags.id AND n.deleted_at IS NULL), 0);

UPDATE notebooks SET note_count = COALESCE((
    SELECT COUNT(*) FROM notes n
    WHERE n.notebook_id = notebooks.id AND n.deleted_at IS NULL), 0);
