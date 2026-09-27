-- Additive flight/fuel domain. The previous application can run after this migration.
INSERT INTO permissions VALUES ('flights.view', 'View own flights'), ('fuel.request', 'Request fuel for own flights');
-- statement-breakpoint
INSERT INTO role_permissions SELECT r.id, p.key FROM roles r CROSS JOIN permissions p
WHERE r.key IN ('ADMIN', 'STUDENT') AND p.key IN ('flights.view', 'fuel.request');
-- statement-breakpoint
CREATE TABLE flights (
  id TEXT PRIMARY KEY,
  flightlogger_booking_id TEXT NOT NULL UNIQUE,
  booking_type TEXT NOT NULL CHECK (booking_type IN ('SingleStudentBooking','MultiStudentBooking')),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  flight_starts_at TEXT, flight_ends_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN','COMPLETED','PARTIALLY_COMPLETED','CANCELLED')),
  flightlogger_aircraft_id TEXT, aircraft_callsign TEXT, aircraft_model TEXT,
  aircraft_class TEXT, aircraft_type TEXT, fuel_coefficient_measurement TEXT,
  departure_airport_id TEXT, departure_airport_name TEXT,
  arrival_airport_id TEXT, arrival_airport_name TEXT,
  instructor_flightlogger_id TEXT, instructor_first_name TEXT, instructor_last_name TEXT,
  last_synced_at TEXT NOT NULL,
  CHECK (ends_at > starts_at), CHECK (flight_ends_at IS NULL OR flight_starts_at IS NULL OR flight_ends_at > flight_starts_at)
);
-- statement-breakpoint
CREATE INDEX flights_aircraft_time ON flights(flightlogger_aircraft_id, flight_ends_at, ends_at);
-- statement-breakpoint
CREATE INDEX flights_window ON flights(starts_at, ends_at);
-- statement-breakpoint
CREATE TABLE flight_students (
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (flight_id,user_id)
);
-- statement-breakpoint
CREATE INDEX flight_students_user ON flight_students(user_id,flight_id);
-- statement-breakpoint
CREATE TABLE flight_sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_from TEXT NOT NULL, window_to TEXT NOT NULL,
  token_hash TEXT NOT NULL, last_synced_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE TABLE fuel_profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
-- statement-breakpoint
CREATE TABLE fuel_presets (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES fuel_profiles(id),
  key TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL,
  UNIQUE(profile_id,key)
);
-- statement-breakpoint
CREATE TABLE fuel_profile_matchers (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES fuel_profiles(id),
  matcher_type TEXT NOT NULL CHECK (matcher_type IN ('AIRCRAFT_ID','CALLSIGN','MODEL')),
  matcher_value TEXT NOT NULL, priority INTEGER NOT NULL,
  UNIQUE(matcher_type,matcher_value)
);
-- statement-breakpoint
INSERT INTO fuel_profiles(id,name) VALUES ('C182T','Cessna 182T'),('Z242L','Zlin Z242L'),('DA42','DA42');
-- statement-breakpoint
INSERT INTO fuel_presets(id,profile_id,key,label,sort_order) VALUES
('c182-tabs','C182T','TABS','Tabs',1),('c182-holes','C182T','HOLES','Holes',2),('c182-full','C182T','FULL','Full',3),
('z242-mains','Z242L','FULL_MAINS','Full mains',1),('z242-aux','Z242L','FULL_MAINS_AUX','Full mains + aux',2);
-- statement-breakpoint
INSERT INTO fuel_profile_matchers(id,profile_id,matcher_type,matcher_value,priority) VALUES
('trb','C182T','CALLSIGN','LNTRB',100),('trc','C182T','CALLSIGN','LNTRC',100),
('trd','C182T','CALLSIGN','LNTRD',100),('tre','C182T','CALLSIGN','LNTRE',100),
('trb-short','C182T','CALLSIGN','TRB',90),('trc-short','C182T','CALLSIGN','TRC',90),
('trd-short','C182T','CALLSIGN','TRD',90),('tre-short','C182T','CALLSIGN','TRE',90),
('ups','Z242L','CALLSIGN','LNUPS',100),('upt','Z242L','CALLSIGN','LNUPT',100),('upr','Z242L','CALLSIGN','LNUPR',100),
('ups-short','Z242L','CALLSIGN','UPS',90),('upt-short','Z242L','CALLSIGN','UPT',90),('upr-short','Z242L','CALLSIGN','UPR',90),
('pfl','DA42','CALLSIGN','LNPFL',100),('pfd','DA42','CALLSIGN','LNPFD',100),('ftt','DA42','CALLSIGN','LNFTT',100),
('pfl-short','DA42','CALLSIGN','PFL',90),('pfd-short','DA42','CALLSIGN','PFD',90),('ftt-short','DA42','CALLSIGN','FTT',90);
-- statement-breakpoint
CREATE TABLE fuel_requests (
  id TEXT PRIMARY KEY,
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE RESTRICT,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED','CANCELLED','NEEDS_REVIEW')),
  request_kind TEXT NOT NULL CHECK (request_kind IN ('PRESET','QUANTITY')),
  fuel_profile_id TEXT REFERENCES fuel_profiles(id),
  preset_key TEXT, preset_label_snapshot TEXT,
  quantity_value REAL, quantity_unit TEXT CHECK (quantity_unit IN ('L','US_GAL')),
  flightlogger_booking_id TEXT NOT NULL,
  flight_starts_at_snapshot TEXT,
  flight_ends_at_snapshot TEXT,
  flightlogger_aircraft_id_snapshot TEXT NOT NULL,
  aircraft_callsign_snapshot TEXT,
  aircraft_model_snapshot TEXT,
  departure_airport_id_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT, completed_by_user_id TEXT REFERENCES users(id),
  cancelled_at TEXT, review_reason TEXT CHECK (review_reason IN ('AIRCRAFT_CHANGED','DEPARTURE_CHANGED')),
  CHECK ((request_kind='PRESET' AND fuel_profile_id IS NOT NULL AND preset_key IS NOT NULL AND preset_label_snapshot IS NOT NULL
    AND quantity_value IS NULL AND quantity_unit IS NULL) OR
    (request_kind='QUANTITY' AND preset_key IS NULL AND preset_label_snapshot IS NULL AND quantity_value > 0 AND quantity_unit IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL))
);
-- statement-breakpoint
CREATE UNIQUE INDEX fuel_requests_one_current ON fuel_requests(flight_id) WHERE status <> 'CANCELLED';
-- statement-breakpoint
CREATE INDEX fuel_requests_status ON fuel_requests(status,flight_id);
-- statement-breakpoint
CREATE TABLE fuel_request_events (
  id TEXT PRIMARY KEY,
  fuel_request_id TEXT NOT NULL REFERENCES fuel_requests(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('REQUEST_CREATED','REQUEST_UPDATED','REQUEST_CANCELLED','REQUEST_COMPLETED','NEEDS_REVIEW_SET','REVIEW_RESOLVED','FLIGHT_CANCELLED')),
  created_at TEXT NOT NULL,
  -- Bounded, predefined operational snapshots only; never an arbitrary request body.
  aircraft_id_snapshot TEXT, request_label_snapshot TEXT
);
-- statement-breakpoint
CREATE INDEX fuel_request_events_request ON fuel_request_events(fuel_request_id,created_at,id);
-- statement-breakpoint
CREATE TABLE fuel_request_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CONSTRAINT fuel_request_guard CHECK(revision>=0)
);
-- statement-breakpoint
INSERT INTO fuel_request_state VALUES(1,0);
-- statement-breakpoint
-- Works during migration-before-deploy, including credential replacement by old code.
CREATE TRIGGER flight_connection_changed AFTER UPDATE OF flightlogger_user_id ON users
BEGIN
  DELETE FROM flight_students WHERE user_id=NEW.id AND OLD.flightlogger_user_id IS NOT NEW.flightlogger_user_id;
  DELETE FROM flight_sync_state WHERE user_id=NEW.id;
END;
