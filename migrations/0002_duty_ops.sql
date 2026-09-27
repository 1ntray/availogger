-- Names are learned only from the authenticated FlightLogger self query.
ALTER TABLE users ADD COLUMN flightlogger_first_name TEXT;
ALTER TABLE users ADD COLUMN flightlogger_last_name TEXT;

CREATE TABLE duty_ops_shifts (
  id TEXT PRIMARY KEY,
  flightlogger_booking_id TEXT NOT NULL UNIQUE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  status TEXT NOT NULL,
  participant_count INTEGER NOT NULL CHECK (participant_count >= 0),
  external_reference TEXT,
  last_synced_at TEXT NOT NULL
);
CREATE INDEX duty_ops_shifts_window ON duty_ops_shifts (starts_at, ends_at);

CREATE TABLE duty_ops_assignments (
  shift_id TEXT NOT NULL REFERENCES duty_ops_shifts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (shift_id, user_id)
);
CREATE INDEX duty_ops_assignments_user ON duty_ops_assignments (user_id, shift_id);

CREATE TABLE duty_ops_sync_state (
  scope TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  token_hash TEXT,
  last_synced_at TEXT NOT NULL
);
