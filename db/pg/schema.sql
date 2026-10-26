-- PostgreSQL schema — the production counterpart of db/schema/*.sql.
--
-- Differences from the SQLite version, and why:
--   * timestamps stay BIGINT epoch milliseconds (not timestamptz) so the JS
--     layer passes the exact same integers and no driver timezone conversion
--     can creep in;
--   * booleans are real BOOLEAN (SQLite had INTEGER 0/1);
--   * JSON columns are JSONB, so args/flags/effects are queryable;
--   * full-text search is a generated tsvector column + GIN index, which is
--     maintained by the database exactly like the FTS5 triggers were;
--   * `sort_id` is a BIGINT IDENTITY (SQLite's AUTOINCREMENT) and stays the
--     immutable ordering/search key.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT UNIQUE,
  about          TEXT,
  kind           TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'business')),
  avatar_hue     INTEGER,
  last_active_at BIGINT
);

CREATE TABLE IF NOT EXISTS groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  invite_epoch INTEGER NOT NULL DEFAULT 1,
  invite_token TEXT
);

CREATE TABLE IF NOT EXISTS group_settings (
  group_id      TEXT PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  locked        BOOLEAN NOT NULL DEFAULT FALSE,
  announcement  BOOLEAN NOT NULL DEFAULT FALSE,
  slow_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (slow_seconds BETWEEN 0 AND 86400),
  anti_link     BOOLEAN NOT NULL DEFAULT FALSE,
  welcome       TEXT,
  rules         TEXT,
  warn_limit    INTEGER NOT NULL DEFAULT 3 CHECK (warn_limit BETWEEN 1 AND 10),
  warn_action   TEXT NOT NULL DEFAULT 'mute' CHECK (warn_action IN ('mute', 'kick')),
  pinned_text   TEXT,
  pinned_by     TEXT REFERENCES users (id),
  pinned_at     BIGINT,
  updated_at    BIGINT
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id        TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'bot')),
  muted           BOOLEAN NOT NULL DEFAULT FALSE,
  muted_until     BIGINT,
  banned          BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at       BIGINT NOT NULL,
  last_message_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_owner_per_group ON group_members (group_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS members_by_user ON group_members (user_id);
CREATE INDEX IF NOT EXISTS members_by_role ON group_members (group_id, role);

CREATE TABLE IF NOT EXISTS warnings (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason     TEXT,
  created_by TEXT REFERENCES users (id),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS warnings_lookup ON warnings (group_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_statuses (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  text        TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 700),
  author_id   TEXT NOT NULL REFERENCES users (id),
  author_name TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS statuses_live ON group_statuses (group_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  actor_id   TEXT,
  command    TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT,
  ok         BOOLEAN NOT NULL DEFAULT TRUE,
  effects    JSONB,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_by_group ON audit_log (group_id, id DESC);

CREATE TABLE IF NOT EXISTS pending_actions (
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  command    TEXT NOT NULL,
  args       JSONB NOT NULL DEFAULT '[]'::jsonb,
  flags      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (group_id, actor_id)
);
CREATE INDEX IF NOT EXISTS pending_expiry ON pending_actions (expires_at);

CREATE TABLE IF NOT EXISTS undo_stack (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  actor_id   TEXT,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS undo_by_group ON undo_stack (group_id, id);

CREATE TABLE IF NOT EXISTS chats (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'business', 'channel')),
  name         TEXT NOT NULL,
  group_id     TEXT UNIQUE REFERENCES groups (id) ON DELETE CASCADE,
  peer_user_id TEXT REFERENCES users (id),
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_hue   INTEGER
);
CREATE INDEX IF NOT EXISTS chats_by_kind ON chats (kind);

CREATE TABLE IF NOT EXISTS messages (
  sort_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  chat_id    TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  sender_id  TEXT REFERENCES users (id),
  text       TEXT NOT NULL DEFAULT '',
  timestamp  BIGINT NOT NULL,
  edited_at  BIGINT,
  deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  search_tsv TSVECTOR GENERATED ALWAYS AS (
               to_tsvector('simple', coalesce(text, ''))
             ) STORED
);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS messages_by_sender ON messages (sender_id, timestamp DESC);
-- prefix search ('sourd' -> 'sourd:*') is served by this index
CREATE INDEX IF NOT EXISTS messages_search ON messages USING GIN (search_tsv);

COMMIT;
