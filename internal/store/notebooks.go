package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Notebook groups notes. Names are unique and case-insensitive in practice.
type Notebook struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Icon        string    `json:"icon"`
	Color       string    `json:"color"`
	Description string    `json:"description,omitempty"`
	SortOrder   int       `json:"sortOrder"`
	Pinned      bool      `json:"pinned"`
	Count       int       `json:"count"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// listNotebooksSQL reads the materialised note_count. idx_notebooks_order
// covers the ORDER BY, so no join, no aggregation and no scan of notes.
const listNotebooksSQL = `
	SELECT nb.id, nb.name, nb.icon, nb.color, nb.description, nb.sort_order, nb.pinned,
	       nb.created_at, nb.updated_at, nb.note_count
	FROM notebooks nb
	ORDER BY nb.pinned DESC, nb.sort_order, nb.name`

// ListNotebooks returns notebooks with their live note counts.
func (s *Store) ListNotebooks() ([]Notebook, error) {
	rows, err := s.db.Query(listNotebooksSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Notebook{}
	for rows.Next() {
		var nb Notebook
		var created, updated string
		if err := rows.Scan(&nb.ID, &nb.Name, &nb.Icon, &nb.Color, &nb.Description,
			&nb.SortOrder, &nb.Pinned, &created, &updated, &nb.Count); err != nil {
			return nil, err
		}
		nb.CreatedAt = parseTime(created)
		nb.UpdatedAt = parseTime(updated)
		out = append(out, nb)
	}
	return out, rows.Err()
}

// CreateNotebook creates a notebook. On a name clash it returns the existing
// row with created=false; callers use that flag to avoid reporting a write
// (activity log, UI change event, status code) that never happened.
func (s *Store) CreateNotebook(name, icon, color, description string) (*Notebook, bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, false, errors.New("notebook name is required")
	}
	if nb, err := s.GetNotebookByName(name); err == nil {
		return nb, false, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	if icon == "" {
		icon = "book"
	}
	if color == "" {
		color = colorFor(name)
	}
	now := nowString()
	var maxOrder sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(sort_order) FROM notebooks`).Scan(&maxOrder)

	nb := &Notebook{
		ID:          NewID("nb"),
		Name:        name,
		Icon:        icon,
		Color:       color,
		Description: description,
		SortOrder:   int(maxOrder.Int64) + 1,
		CreatedAt:   parseTime(now),
		UpdatedAt:   parseTime(now),
	}
	if _, err := s.db.Exec(
		`INSERT INTO notebooks (id, name, icon, color, description, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		nb.ID, nb.Name, nb.Icon, nb.Color, nb.Description, nb.SortOrder, now, now,
	); err != nil {
		return nil, false, fmt.Errorf("create notebook: %w", err)
	}
	return nb, true, nil
}

// GetNotebookByName looks up a notebook case-insensitively.
func (s *Store) GetNotebookByName(name string) (*Notebook, error) {
	row := s.db.QueryRow(`
		SELECT nb.id, nb.name, nb.icon, nb.color, nb.description, nb.sort_order, nb.pinned,
		       nb.created_at, nb.updated_at, nb.note_count
		FROM notebooks nb WHERE lower(nb.name) = lower(?)`, strings.TrimSpace(name))
	var nb Notebook
	var created, updated string
	err := row.Scan(&nb.ID, &nb.Name, &nb.Icon, &nb.Color, &nb.Description,
		&nb.SortOrder, &nb.Pinned, &created, &updated, &nb.Count)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	nb.CreatedAt = parseTime(created)
	nb.UpdatedAt = parseTime(updated)
	return &nb, nil
}

// UpdateNotebook renames, re-describes or pins a notebook.
func (s *Store) UpdateNotebook(id string, name, icon, color, description *string, pinned *bool) (*Notebook, error) {
	cur, err := s.notebookByID(id)
	if err != nil {
		return nil, err
	}
	if name != nil && strings.TrimSpace(*name) != "" {
		n := strings.TrimSpace(*name)
		if taken, err := s.nameTaken("notebooks", n, id); err != nil {
			return nil, err
		} else if taken {
			return nil, errors.New("已存在同名笔记本")
		}
		cur.Name = n
	}
	if icon != nil && *icon != "" {
		cur.Icon = *icon
	}
	if color != nil {
		cur.Color = *color
	}
	if description != nil {
		cur.Description = *description
	}
	if pinned != nil {
		cur.Pinned = *pinned
	}
	if _, err := s.db.Exec(`UPDATE notebooks SET name = ?, icon = ?, color = ?, description = ?,
		pinned = ?, updated_at = ? WHERE id = ?`,
		cur.Name, cur.Icon, cur.Color, cur.Description, boolInt(cur.Pinned), nowString(), id); err != nil {
		return nil, err
	}
	return s.notebookByID(id)
}

// nameTaken reports whether another row already uses this name (case insensitive).
func (s *Store) nameTaken(table, name, id string) (bool, error) {
	var other string
	err := s.db.QueryRow(`SELECT id FROM `+table+` WHERE lower(name) = lower(?) AND id <> ?`, name, id).Scan(&other)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) notebookByID(id string) (*Notebook, error) {
	row := s.db.QueryRow(`SELECT id, name, icon, color, description, sort_order, pinned, created_at, updated_at
		FROM notebooks WHERE id = ?`, id)
	var nb Notebook
	var created, updated string
	err := row.Scan(&nb.ID, &nb.Name, &nb.Icon, &nb.Color, &nb.Description, &nb.SortOrder, &nb.Pinned, &created, &updated)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	nb.CreatedAt = parseTime(created)
	nb.UpdatedAt = parseTime(updated)
	return &nb, nil
}

// DeleteNotebook removes a notebook; its notes become uncategorized.
func (s *Store) DeleteNotebook(id string) error {
	res, err := s.db.Exec(`DELETE FROM notebooks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// resolveNotebook maps a name/id to a notebook row id, optionally creating it.
func resolveNotebook(tx *sql.Tx, id, name string, create bool) (string, string, error) {
	if strings.TrimSpace(id) != "" {
		var nbName string
		err := tx.QueryRow(`SELECT name FROM notebooks WHERE id = ?`, id).Scan(&nbName)
		if err == nil {
			return id, nbName, nil
		}
		if err != sql.ErrNoRows {
			return "", "", err
		}
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "", "", nil
	}

	var nbID, nbName string
	err := tx.QueryRow(`SELECT id, name FROM notebooks WHERE lower(name) = lower(?)`, name).Scan(&nbID, &nbName)
	if err == nil {
		return nbID, nbName, nil
	}
	if err != sql.ErrNoRows {
		return "", "", err
	}
	if !create {
		return "", "", nil
	}

	now := nowString()
	nbID = NewID("nb")
	var maxOrder sql.NullInt64
	_ = tx.QueryRow(`SELECT MAX(sort_order) FROM notebooks`).Scan(&maxOrder)
	if _, err := tx.Exec(
		`INSERT INTO notebooks (id, name, icon, color, description, sort_order, created_at, updated_at)
		 VALUES (?, ?, 'book', ?, '', ?, ?, ?)`,
		nbID, name, colorFor(name), int(maxOrder.Int64)+1, now, now,
	); err != nil {
		return "", "", fmt.Errorf("resolve notebook: %w", err)
	}
	return nbID, name, nil
}

// colorFor picks a stable accent colour for a notebook or tag name.
func colorFor(name string) string {
	palette := []string{"#a8bc8d", "#97b6c3", "#d4b989", "#b4a1c5", "#c3a6a0", "#8fae9b"}
	var h uint32 = 2166136261
	for _, r := range name {
		h ^= uint32(r)
		h *= 16777619
	}
	return palette[int(h%uint32(len(palette)))]
}
