-- Planned lessons are bounded in the FlightLogger parser and stored separately
-- from the canonical booking so multi-student bookings retain every lesson.
CREATE TABLE flight_planned_lessons (
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 7),
  training_id TEXT NOT NULL CHECK(length(training_id) BETWEEN 1 AND 128),
  training_name TEXT NOT NULL CHECK(length(training_name) BETWEEN 1 AND 256),
  lecture_id TEXT CHECK(lecture_id IS NULL OR length(lecture_id) BETWEEN 1 AND 128),
  lecture_name TEXT CHECK(lecture_name IS NULL OR length(lecture_name) BETWEEN 1 AND 256),
  PRIMARY KEY(flight_id, position),
  UNIQUE(flight_id, training_id)
);
