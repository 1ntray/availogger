-- Additive, append-only flight history and personal Inbox. Safe before new code deploys.
CREATE TABLE flight_change_events (
  id TEXT PRIMARY KEY,
  flight_id TEXT REFERENCES flights(id) ON DELETE SET NULL,
  flightlogger_booking_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('CHANGED','CANCELLED','RESTORED','FLIGHT_ADDED','FLIGHT_REMOVED')),
  subject_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  detected_at TEXT NOT NULL,
  starts_at_snapshot TEXT NOT NULL,
  ends_at_snapshot TEXT NOT NULL,
  flight_starts_at_snapshot TEXT,
  flight_ends_at_snapshot TEXT,
  aircraft_callsign_snapshot TEXT,
  aircraft_model_snapshot TEXT,
  status_snapshot TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX flight_change_events_booking ON flight_change_events(flightlogger_booking_id,detected_at,id);
-- statement-breakpoint
CREATE TABLE flight_change_items (
  event_id TEXT NOT NULL REFERENCES flight_change_events(id) ON DELETE RESTRICT,
  field TEXT NOT NULL CHECK(field IN ('FLIGHT_START','FLIGHT_END','BOOKING_START','BOOKING_END','AIRCRAFT','INSTRUCTOR','DEPARTURE_AIRPORT','ARRIVAL_AIRPORT','STATUS')),
  old_value TEXT, new_value TEXT,
  old_label TEXT, new_label TEXT,
  old_detail TEXT, new_detail TEXT,
  PRIMARY KEY(event_id,field),
  CHECK(old_value IS NULL OR length(old_value)<=256),
  CHECK(new_value IS NULL OR length(new_value)<=256),
  CHECK(old_label IS NULL OR length(old_label)<=256),
  CHECK(new_label IS NULL OR length(new_label)<=256),
  CHECK(old_detail IS NULL OR length(old_detail)<=256),
  CHECK(new_detail IS NULL OR length(new_detail)<=256)
);
-- statement-breakpoint
CREATE TABLE user_inbox_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 40),
  source_type TEXT NOT NULL CHECK(length(source_type) BETWEEN 1 AND 40),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 256),
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(user_id,source_type,source_id)
);
-- statement-breakpoint
CREATE INDEX user_inbox_recent ON user_inbox_items(user_id,created_at DESC,id DESC);
-- statement-breakpoint
CREATE INDEX user_inbox_unread ON user_inbox_items(user_id,read_at);
-- statement-breakpoint
-- A replaced key establishes a fresh observation baseline, even when it
-- resolves to the same FlightLogger user ID as the old key.
CREATE TRIGGER flight_key_reconnected AFTER UPDATE OF token_ciphertext ON flightlogger_credentials
BEGIN
  DELETE FROM flight_students WHERE user_id=NEW.user_id;
  DELETE FROM flight_sync_state WHERE user_id=NEW.user_id;
END;
