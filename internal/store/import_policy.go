package store

// ImportNote keeps duplicate decisions within the persistence layer.
func (s *Store) ImportNote(in NoteInput, mode string) (*Note, bool, bool, error) {
	existing, err := s.findExisting(in)
	if err != nil {
		return nil, false, false, err
	}
	if existing == nil || mode == "copy" {
		n, err := s.CreateNote(in)
		return n, true, false, err
	}
	if existing.Content == in.Content || mode != "replace" {
		return existing, false, true, nil
	}
	n, err := s.UpdateNote(existing.ID, NotePatch{Title: &in.Title, Content: &in.Content, Tags: &in.Tags, Notebook: &in.Notebook, Source: "import", ForceRevision: true})
	return n, false, false, err
}

// DiscardPlaceholder refuses to delete a named, edited, tagged or pinned note.
func (s *Store) DiscardPlaceholder(id string) error {
	_, err := s.db.Exec(`DELETE FROM notes WHERE id=? AND title='未命名笔记' AND trim(content)='' AND version=1 AND pinned=0 AND source='web' AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM note_tags WHERE note_id=notes.id) AND NOT EXISTS(SELECT 1 FROM note_revisions WHERE note_id=notes.id)`, id)
	return err
}
