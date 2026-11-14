-- Trigram is the only bundled FTS5 tokenizer supporting Chinese substring
-- search. External content means note bodies are not duplicated: FTS5 stores
-- only the trigram posting lists and reads column values back from notes.
-- content_rowid must be the integer rowid, which every ordinary SQLite table
-- has even when its PRIMARY KEY is TEXT.
--
-- Trigram needs >= 3 characters, so short queries fall back to a LIKE scan
-- over the materialised notes.tags_text column (see ftsEligible).

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, content, tags_text,
    content='notes', content_rowid='rowid',
    tokenize='trigram'
);
