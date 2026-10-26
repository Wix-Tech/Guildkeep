-- 001_init.sql — core schema for chatting + group administration.
--
-- Conventions
--   * every id is TEXT (stable, copy-able across environments);
--   * messages get a monotonic INTEGER `sort_id` used as the ordering key and
--     as the search-index rowid (this is the one idea worth stealing from any
--     messenger: never index by a mutable primary key);
--   * booleans are INTEGER 0/1 with CHECK constraints;
--   * timestamps are INTEGER epoch milliseconds, always UTC.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT UNIQUE,
  about          TEXT,
  kind           TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'business')),
  avatar_hue     INTEGER,
  last_active_at INTEGER
);

CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  invite_epoch INTEGER NOT NULL DEFAULT 1,
  invite_token TEXT
);

-- One row per group: everything /lock, /slowmode, /antilink, /welcome …
-- can change. Kept separate from `groups` so the hot row is small.
CREATE TABLE group_settings (
  group_id      TEXT PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  announcement  INTEGER NOT NULL DEFAULT 0 CHECK (announcement IN (0, 1)),
  slow_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (slow_seconds >= 0 AND slow_seconds <= 86400),
  anti_link     INTEGER NOT NULL DEFAULT 0 CHECK (anti_link IN (0, 1)),
  welcome       TEXT,
  rules         TEXT,
  warn_limit    INTEGER NOT NULL DEFAULT 3 CHECK (warn_limit BETWEEN 1 AND 10),
  warn_action   TEXT NOT NULL DEFAULT 'mute' CHECK (warn_action IN ('mute', 'kick')),
  pinned_text   TEXT,
  pinned_by     TEXT REFERENCES users (id),
  pinned_at     INTEGER,
  updated_at    INTEGER
);

CREATE TABLE group_members (
  group_id         TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'bot')),
  muted            INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  muted_until      INTEGER,
  banned           INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  joined_at        INTEGER NOT NULL,
  last_message_at  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
) WITHOUT ROWID;

-- exactly one owner per group, enforced by the database, not by application code
CREATE UNIQUE INDEX one_owner_per_group ON group_members (group_id) WHERE role = 'owner';
CREATE INDEX members_by_user ON group_members (user_id);
CREATE INDEX members_by_role ON group_members (group_id, role);

CREATE TABLE warnings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason     TEXT,
  created_by TEXT REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE INDEX warnings_lookup ON warnings (group_id, user_id, created_at DESC);

CREATE TABLE group_statuses (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 700),
  author_id   TEXT NOT NULL REFERENCES users (id),
  author_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX statuses_live ON group_statuses (group_id, expires_at DESC);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  actor_id   TEXT,
  command    TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT,
  ok         INTEGER NOT NULL DEFAULT 1 CHECK (ok IN (0, 1)),
  effects    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_by_group ON audit_log (group_id, id DESC);

-- A chat is the thing messages hang off: a direct conversation, a group, or a
-- business thread. `group_id` is set for group chats only.
CREATE TABLE chats (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'business', 'channel')),
  name         TEXT NOT NULL,
  group_id     TEXT UNIQUE REFERENCES groups (id) ON DELETE CASCADE,
  peer_user_id TEXT REFERENCES users (id),
  pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  avatar_hue   INTEGER
);
CREATE INDEX chats_by_kind ON chats (kind);

CREATE TABLE messages (
  sort_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  chat_id    TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  sender_id  TEXT REFERENCES users (id),
  text       TEXT NOT NULL DEFAULT '',
  timestamp  INTEGER NOT NULL,
  edited_at  INTEGER,
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);
CREATE INDEX messages_by_chat ON messages (chat_id, timestamp DESC);
CREATE INDEX messages_by_sender ON messages (sender_id, timestamp DESC);
