-- 002_search.sql — the full-text index.
--
-- FTS5 with external content: the index stores no copy of the text, it points
-- at `messages` through `content_rowid = sort_id`. That means message edits and
-- deletes never leave a stale copy behind, and the dataset does not double in
-- size. Triggers keep it in sync — application code never touches the index.
--
-- `tokenize = 'unicode61 remove_diacritics 2'` gives us what the JS engine
-- normalises by hand: case folding, accent folding ("Tomas" finds "Tomás"),
-- unicode word boundaries. Prefix queries (`sourd*`) are what as-you-type
-- search uses.

CREATE VIRTUAL TABLE message_fts USING fts5 (
  text,
  content = 'messages',
  content_rowid = 'sort_id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER message_fts_ai AFTER INSERT ON messages
WHEN new.deleted = 0
BEGIN
  INSERT INTO message_fts (rowid, text) VALUES (new.sort_id, new.text);
END;

CREATE TRIGGER message_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.sort_id, old.text);
END;

-- Only re-index when the text or the soft-delete flag actually changed.
CREATE TRIGGER message_fts_au AFTER UPDATE OF text, deleted ON messages
BEGIN
  INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.sort_id, old.text);
  INSERT INTO message_fts (rowid, text)
  SELECT new.sort_id, new.text WHERE new.deleted = 0;
END;
