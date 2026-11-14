package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Tag is a lightweight label shared across notebooks.
type Tag struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	Pinned    bool      `json:"pinned"`
	Count     int       `json:"count"`
	CreatedAt time.Time `json:"createdAt"`
}

// listTagsSQL reads the materialised note_count maintained by
// triggers_v3.sql. idx_tags_order covers the ORDER BY, so listing 3k tags is a
// single ordered index scan with no join and no aggregation.
const listTagsSQL = `
	SELECT t.id, t.name, t.color, t.pinned, t.created_at, t.note_count
	FROM tags t
	ORDER BY t.pinned DESC, t.note_count DESC, t.name`

// ListTags returns tags with the number of live notes using them.
func (s *Store) ListTags() ([]Tag, error) {
	rows, err := s.db.Query(listTagsSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Tag{}
	for rows.Next() {
		var t Tag
		var created string
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.Pinned, &created, &t.Count); err != nil {
			return nil, err
		}
		t.CreatedAt = parseTime(created)
		out = append(out, t)
	}
	return out, rows.Err()
}

// CreateTag creates a tag (idempotent by name).
func (s *Store) CreateTag(name, color string) (*Tag, error) {
	name = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(name), "#"))
	if name == "" {
		return nil, errors.New("tag name is required")
	}
	if color == "" {
		color = colorFor(name)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	id, err := ensureTagColor(tx, name, color)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.tagByID(id)
}

// UpdateTag renames, recolours or pins a tag. Notes keep their links because
// note_tags references the tag id rather than its name.
func (s *Store) UpdateTag(id string, name, color *string, pinned *bool) (*Tag, error) {
	cur, err := s.tagByID(id)
	if err != nil {
		return nil, err
	}
	if name != nil {
		n := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(*name), "#"))
		if n == "" {
			return nil, errors.New("标签名称不能为空")
		}
		if taken, err := s.nameTaken("tags", n, id); err != nil {
			return nil, err
		} else if taken {
			return nil, errors.New("已存在同名标签")
		}
		cur.Name = n
	}
	if color != nil && *color != "" {
		cur.Color = *color
	}
	if pinned != nil {
		cur.Pinned = *pinned
	}
	if _, err := s.db.Exec(`UPDATE tags SET name = ?, color = ?, pinned = ? WHERE id = ?`,
		cur.Name, cur.Color, boolInt(cur.Pinned), id); err != nil {
		return nil, err
	}
	return s.tagByID(id)
}

func (s *Store) tagByID(id string) (*Tag, error) {
	row := s.db.QueryRow(`SELECT id, name, color, pinned, created_at FROM tags WHERE id = ?`, id)
	var t Tag
	var created string
	err := row.Scan(&t.ID, &t.Name, &t.Color, &t.Pinned, &created)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	t.CreatedAt = parseTime(created)
	return &t, nil
}

// DeleteTag removes a tag and its links.
func (s *Store) DeleteTag(id string) error {
	res, err := s.db.Exec(`DELETE FROM tags WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ensureTag returns the id of a tag by name, creating it if needed.
func ensureTag(tx *sql.Tx, name string) (string, error) {
	name = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(name), "#"))
	if name == "" {
		return "", errors.New("empty tag")
	}
	var id string
	err := tx.QueryRow(`SELECT id FROM tags WHERE lower(name) = lower(?)`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}
	id = NewID("tag")
	_, err = tx.Exec(`INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		id, name, colorFor(name), nowString())
	if err != nil {
		// A concurrent insert may have won the race; read it back.
		if e := tx.QueryRow(`SELECT id FROM tags WHERE lower(name) = lower(?)`, name).Scan(&id); e == nil {
			return id, nil
		}
		return "", err
	}
	return id, nil
}

func ensureTagColor(tx *sql.Tx, name, color string) (string, error) {
	var id, curColor string
	err := tx.QueryRow(`SELECT id, color FROM tags WHERE lower(name) = lower(?)`, name).Scan(&id, &curColor)
	if err == nil {
		if curColor == "" && color != "" {
			_, _ = tx.Exec(`UPDATE tags SET color = ? WHERE id = ?`, color, id)
		}
		return id, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}
	id = NewID("tag")
	if _, err := tx.Exec(`INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		id, name, color, nowString()); err != nil {
		return "", err
	}
	return id, nil
}
