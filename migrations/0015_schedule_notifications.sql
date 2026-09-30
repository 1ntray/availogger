-- Raw FlightLogger observations are independent of portal Exchange overlays.
CREATE TABLE schedule_observation_state (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK')),
  token_hash TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY(user_id,domain)
);
-- statement-breakpoint
CREATE TABLE schedule_assignment_snapshots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK')),
  source_booking_id TEXT NOT NULL,
  source_assignment_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(user_id,domain,source_booking_id)
);
-- statement-breakpoint
CREATE TABLE schedule_change_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK')),
  type TEXT NOT NULL CHECK(type IN ('ASSIGNED','REMOVED','TIME_CHANGED')),
  source_booking_id TEXT NOT NULL,
  source_assignment_id TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  old_starts_at TEXT,
  old_ends_at TEXT,
  new_starts_at TEXT,
  new_ends_at TEXT,
  CHECK(length(source_booking_id) BETWEEN 1 AND 256),
  CHECK(length(source_assignment_id) BETWEEN 1 AND 256)
);
-- statement-breakpoint
CREATE INDEX schedule_change_events_user ON schedule_change_events(user_id,detected_at,id);
-- statement-breakpoint
CREATE INDEX schedule_change_events_observation ON schedule_change_events(observation_id,type);
-- statement-breakpoint
CREATE TRIGGER schedule_change_events_no_update BEFORE UPDATE OF
  id,domain,type,source_booking_id,source_assignment_id,detected_at,observation_id,
  old_starts_at,old_ends_at,new_starts_at,new_ends_at ON schedule_change_events
BEGIN SELECT RAISE(ABORT,'schedule_event_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER schedule_change_events_subject_no_update BEFORE UPDATE OF user_id ON schedule_change_events
WHEN NEW.user_id IS NOT NULL OR OLD.user_id IS NULL
BEGIN SELECT RAISE(ABORT,'schedule_event_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER schedule_change_events_no_delete BEFORE DELETE ON schedule_change_events
BEGIN SELECT RAISE(ABORT,'schedule_event_immutable'); END;
-- statement-breakpoint
-- An open group accepts additions until its Inbox item is read. The link table
-- retains the exact immutable source events represented by each group.
CREATE TABLE inbox_notification_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('FLIGHTS','DUTY_OPS','FLYVASK')),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 100000),
  open INTEGER NOT NULL CHECK(open IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX inbox_notification_groups_open ON inbox_notification_groups(user_id,domain) WHERE open=1;
-- statement-breakpoint
CREATE TABLE inbox_notification_group_events (
  group_id TEXT NOT NULL REFERENCES inbox_notification_groups(id) ON DELETE CASCADE,
  flight_event_id TEXT REFERENCES flight_change_events(id) ON DELETE RESTRICT,
  schedule_event_id TEXT REFERENCES schedule_change_events(id) ON DELETE RESTRICT,
  CHECK((flight_event_id IS NULL) <> (schedule_event_id IS NULL)),
  UNIQUE(flight_event_id), UNIQUE(schedule_event_id)
);
-- statement-breakpoint
CREATE INDEX inbox_notification_group_events_group ON inbox_notification_group_events(group_id);
-- statement-breakpoint
CREATE TABLE contact_notification_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES contact_threads(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('NEW_FEEDBACK','STUDENT_REPLY','WEBMASTER_REPLY','RESOLVED','REOPENED')),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 100000),
  latest_message_id TEXT REFERENCES contact_messages(id) ON DELETE SET NULL,
  open INTEGER NOT NULL CHECK(open IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX contact_notification_groups_open ON contact_notification_groups(user_id,thread_id,type) WHERE open=1;
-- statement-breakpoint
CREATE TABLE contact_thread_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES contact_threads(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('RESOLVED','REOPENED')),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE TRIGGER contact_thread_events_no_update BEFORE UPDATE OF id,thread_id,type,created_at ON contact_thread_events
BEGIN SELECT RAISE(ABORT,'contact_event_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER contact_thread_events_actor_no_update BEFORE UPDATE OF actor_user_id ON contact_thread_events
WHEN NEW.actor_user_id IS NOT NULL OR OLD.actor_user_id IS NULL
BEGIN SELECT RAISE(ABORT,'contact_event_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER contact_thread_events_no_delete BEFORE DELETE ON contact_thread_events
BEGIN SELECT RAISE(ABORT,'contact_event_immutable'); END;
-- statement-breakpoint
-- Replacing even the same user's key makes the next observation a baseline.
CREATE TRIGGER schedule_connection_changed AFTER UPDATE OF token_ciphertext ON flightlogger_credentials
BEGIN
  DELETE FROM schedule_assignment_snapshots WHERE user_id=NEW.user_id;
  DELETE FROM schedule_observation_state WHERE user_id=NEW.user_id;
END;
