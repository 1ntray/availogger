-- 0012 belongs to the parallel Exchange v2 feature. Contact is intentionally 0013.
INSERT INTO permissions VALUES ('contact.webmaster.manage', 'Manage webmaster contact messages');
-- statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key) SELECT id, 'contact.webmaster.manage' FROM roles WHERE key='ADMIN';
-- statement-breakpoint
CREATE TABLE contact_channels (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  recipient_permission_key TEXT NOT NULL REFERENCES permissions(key),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  user_facing INTEGER NOT NULL CHECK(user_facing IN (0,1))
);
-- statement-breakpoint
INSERT INTO contact_channels VALUES ('webmaster', 'Webmaster', 'contact.webmaster.manage', 1, 1);
-- statement-breakpoint
CREATE TABLE contact_threads (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL REFERENCES contact_channels(id) ON DELETE RESTRICT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK(category IN ('BUG','IMPROVEMENT','IDEA','OTHER')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  current_path TEXT CHECK(current_path IS NULL OR length(current_path)<=256),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_webmaster_message_id TEXT,
  CHECK((status='OPEN' AND resolved_at IS NULL) OR (status='RESOLVED' AND resolved_at IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX contact_threads_owner_recent ON contact_threads(created_by_user_id,updated_at DESC,id DESC);
-- statement-breakpoint
CREATE INDEX contact_threads_channel_status_recent ON contact_threads(channel_id,status,updated_at DESC,id DESC);
-- statement-breakpoint
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES contact_threads(id) ON DELETE RESTRICT,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX contact_messages_thread ON contact_messages(thread_id,created_at,id);
-- statement-breakpoint
CREATE TABLE contact_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0));
-- statement-breakpoint
INSERT INTO contact_state VALUES (1,0);
-- statement-breakpoint
CREATE TRIGGER contact_messages_no_update BEFORE UPDATE ON contact_messages BEGIN SELECT RAISE(ABORT,'contact_message_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER contact_messages_no_delete BEFORE DELETE ON contact_messages BEGIN SELECT RAISE(ABORT,'contact_message_immutable'); END;
