-- 004_undo_stack.sql — /undo must work across requests, not just across a
-- process. The bot pushes reversible actions onto a stack; that stack is state
-- like any other, so it belongs in the database.
--
-- `payload` is the JSON the bot needs to reverse the action (previous setting
-- value, or a snapshot of the removed member). Rows are replaced wholesale
-- after each command (the stack is capped at 50 entries), which keeps this
-- table from ever drifting out of sync with the audit log.

CREATE TABLE undo_stack (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  actor_id   TEXT,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX undo_by_group ON undo_stack (group_id, id);
