-- 0004 is reserved for the parallel Duty Ops swaps branch. No dependency on it.
INSERT INTO permissions VALUES ('transport.book_university_cars', 'Book university cars');
-- statement-breakpoint
INSERT INTO role_permissions SELECT id, 'transport.book_university_cars' FROM roles WHERE key IN ('STUDENT', 'ADMIN');
-- statement-breakpoint
UPDATE authorization_state SET revision = revision + 1 WHERE id = 1;
-- statement-breakpoint
CREATE TABLE transport_vehicles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
-- statement-breakpoint
INSERT INTO transport_vehicles VALUES ('university-car-1', 'Car 1'), ('university-car-2', 'Car 2');
-- statement-breakpoint
CREATE TABLE transport_car_bookings (
  id TEXT PRIMARY KEY NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES transport_vehicles(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK (origin IN ('ISTIND', 'UTSA', 'NAERINGSHAGEN')),
  destination TEXT NOT NULL CHECK (destination IN ('ISTIND', 'UTSA', 'NAERINGSHAGEN') AND destination <> origin),
  starts_at TEXT NOT NULL CHECK (length(starts_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', starts_at) IS NOT NULL AND starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', starts_at)),
  ends_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', starts_at, '+10 minutes') IS NOT NULL AND ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', starts_at, '+10 minutes')),
  status TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'CANCELLED')),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (confirmed_at IS NULL OR (status = 'BOOKED' AND confirmed_at >= ends_at))
);
-- statement-breakpoint
CREATE INDEX transport_bookings_by_vehicle ON transport_car_bookings(vehicle_id, status, starts_at, ends_at);
-- statement-breakpoint
CREATE INDEX transport_bookings_by_user ON transport_car_bookings(user_id, status, confirmed_at, ends_at);
-- statement-breakpoint
CREATE TRIGGER transport_no_booking_overlap_insert BEFORE INSERT ON transport_car_bookings
WHEN NEW.status = 'BOOKED' AND EXISTS (SELECT 1 FROM transport_car_bookings
  WHERE vehicle_id = NEW.vehicle_id AND status = 'BOOKED' AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at)
BEGIN SELECT RAISE(ABORT, 'transport_booking_overlap'); END;
-- statement-breakpoint
CREATE TRIGGER transport_no_booking_overlap_update BEFORE UPDATE ON transport_car_bookings
WHEN NEW.status = 'BOOKED' AND EXISTS (SELECT 1 FROM transport_car_bookings
  WHERE id <> NEW.id AND vehicle_id = NEW.vehicle_id AND status = 'BOOKED' AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at)
BEGIN SELECT RAISE(ABORT, 'transport_booking_overlap'); END;
-- statement-breakpoint
-- Sequence breaks timestamp ties and preserves event insertion order. No fake location seeds.
CREATE TABLE transport_vehicle_location_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  vehicle_id TEXT NOT NULL REFERENCES transport_vehicles(id) ON DELETE RESTRICT,
  location TEXT NOT NULL CHECK (location IN ('ISTIND', 'UTSA', 'NAERINGSHAGEN')),
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  booking_id TEXT REFERENCES transport_car_bookings(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('MANUAL_UPDATE', 'TRIP_CONFIRMATION', 'TRIP_CORRECTION')),
  created_at TEXT NOT NULL,
  CHECK ((source = 'MANUAL_UPDATE' AND booking_id IS NULL) OR (source <> 'MANUAL_UPDATE' AND booking_id IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX transport_locations_by_vehicle ON transport_vehicle_location_events(vehicle_id, created_at, sequence);
-- statement-breakpoint
CREATE UNIQUE INDEX transport_one_confirmation_event ON transport_vehicle_location_events(booking_id) WHERE booking_id IS NOT NULL;
-- statement-breakpoint
CREATE TRIGGER transport_location_events_immutable_update BEFORE UPDATE ON transport_vehicle_location_events
BEGIN SELECT RAISE(ABORT, 'transport_location_history_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER transport_location_events_immutable_delete BEFORE DELETE ON transport_vehicle_location_events
BEGIN SELECT RAISE(ABORT, 'transport_location_history_immutable'); END;
-- statement-breakpoint
CREATE TABLE transport_private_rides (
  id TEXT PRIMARY KEY NOT NULL,
  driver_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL CHECK (length(origin) BETWEEN 1 AND 80),
  destination TEXT NOT NULL CHECK (length(destination) BETWEEN 1 AND 80),
  departure_at TEXT NOT NULL CHECK (length(departure_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', departure_at) IS NOT NULL AND departure_at = strftime('%Y-%m-%dT%H:%M:%fZ', departure_at)),
  seat_count INTEGER NOT NULL CHECK (typeof(seat_count) = 'integer' AND seat_count BETWEEN 1 AND 8),
  note TEXT CHECK (note IS NULL OR length(note) <= 280),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CANCELLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX transport_rides_by_departure ON transport_private_rides(status, departure_at);
-- statement-breakpoint
CREATE INDEX transport_rides_by_driver ON transport_private_rides(driver_user_id, departure_at);
-- statement-breakpoint
CREATE TABLE transport_private_ride_passengers (
  ride_id TEXT NOT NULL REFERENCES transport_private_rides(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (ride_id, user_id)
);
-- statement-breakpoint
CREATE INDEX transport_passengers_by_user ON transport_private_ride_passengers(user_id, ride_id);
-- statement-breakpoint
CREATE TRIGGER transport_passenger_integrity BEFORE INSERT ON transport_private_ride_passengers
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM transport_private_rides WHERE id = NEW.ride_id AND driver_user_id = NEW.user_id)
    THEN RAISE(ABORT, 'transport_driver_cannot_join') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM transport_private_rides WHERE id = NEW.ride_id AND status = 'OPEN' AND departure_at > NEW.joined_at)
    THEN RAISE(ABORT, 'transport_ride_unavailable') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM transport_private_ride_passengers WHERE ride_id = NEW.ride_id) >=
    (SELECT seat_count FROM transport_private_rides WHERE id = NEW.ride_id)
    THEN RAISE(ABORT, 'transport_ride_full') END;
END;
