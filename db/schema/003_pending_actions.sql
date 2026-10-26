-- 003_pending_actions.sql — two-step confirmations must survive a restart.
--
-- Destructive commands (/kick, /ban, /purge, /invite reset) park their intent
-- and wait for /confirm. Keeping that in process memory means a deploy between
-- the prompt and the confirm silently loses the action, so it lives here.
-- One pending action per actor at a time.

CREATE TABLE pending_actions (
  actor_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  command    TEXT NOT NULL,
  args       TEXT NOT NULL DEFAULT '[]',
  flags      TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, actor_id)
) WITHOUT ROWID;

CREATE INDEX pending_expiry ON pending_actions (expires_at);
