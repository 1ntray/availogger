-- 0010 is reserved for Brakkevakt. It does not depend on the parallel 0009 feature.
INSERT INTO permissions VALUES
  ('brakkevakt.view', 'View Brakkevakt'),
  ('brakkevakt.swap', 'Swap Brakkevakt assignments'),
  ('brakkevakt.manage_schedule', 'Manage Brakkevakt schedule');
-- statement-breakpoint
INSERT INTO role_permissions SELECT r.id, p.key FROM roles r CROSS JOIN permissions p
WHERE (r.key = 'STUDENT' AND p.key IN ('brakkevakt.view', 'brakkevakt.swap'))
   OR (r.key = 'ADMIN' AND p.key IN ('brakkevakt.view', 'brakkevakt.swap', 'brakkevakt.manage_schedule'));
-- statement-breakpoint
CREATE TABLE brakkevakt_periods (
  id TEXT PRIMARY KEY NOT NULL,
  week_start TEXT NOT NULL UNIQUE CHECK (week_start GLOB '????-??-??' AND date(week_start) = week_start AND strftime('%w', week_start) = '1'),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
-- statement-breakpoint
CREATE TABLE brakkevakt_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  period_id TEXT NOT NULL REFERENCES brakkevakt_periods(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL,
  assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (period_id, slot), UNIQUE (period_id, user_id)
);
-- statement-breakpoint
CREATE INDEX brakkevakt_assignments_user ON brakkevakt_assignments(user_id, period_id);
-- statement-breakpoint
CREATE TRIGGER brakkevakt_no_partial_insert BEFORE INSERT ON brakkevakt_periods
WHEN NEW.published = 1
BEGIN SELECT RAISE(ABORT, 'brakkevakt_two_required'); END;
-- statement-breakpoint
CREATE TRIGGER brakkevakt_publish_two BEFORE UPDATE OF published ON brakkevakt_periods
WHEN NEW.published = 1 AND (SELECT COUNT(*) FROM brakkevakt_assignments WHERE period_id = NEW.id) <> 2
BEGIN SELECT RAISE(ABORT, 'brakkevakt_two_required'); END;
-- statement-breakpoint
CREATE TRIGGER brakkevakt_no_partial_delete BEFORE DELETE ON brakkevakt_assignments
WHEN EXISTS (SELECT 1 FROM brakkevakt_periods WHERE id = OLD.period_id AND published = 1)
  AND NOT EXISTS (SELECT 1 FROM brakkevakt_state WHERE id = 1 AND deleting_period_id = OLD.period_id)
BEGIN SELECT RAISE(ABORT, 'brakkevakt_two_required'); END;
-- statement-breakpoint
CREATE TABLE brakkevakt_swap_requests (
  id TEXT PRIMARY KEY NOT NULL,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_assignment_id TEXT REFERENCES brakkevakt_assignments(id) ON DELETE SET NULL,
  requested_week_start TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'CANCELLED', 'INVALIDATED')),
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  accepted_proposal_id TEXT REFERENCES brakkevakt_swap_proposals(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  accepted_at TEXT, cancelled_at TEXT, invalidated_at TEXT,
  CHECK ((status = 'ACCEPTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL AND accepted_proposal_id IS NOT NULL)
    OR (status <> 'ACCEPTED' AND accepted_by_user_id IS NULL AND accepted_at IS NULL AND accepted_proposal_id IS NULL))
);
-- statement-breakpoint
CREATE INDEX brakkevakt_swap_requests_page ON brakkevakt_swap_requests(status, created_at DESC, id DESC);
-- statement-breakpoint
CREATE TABLE brakkevakt_swap_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES brakkevakt_swap_requests(id) ON DELETE RESTRICT,
  proposer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  offered_assignment_id TEXT REFERENCES brakkevakt_assignments(id) ON DELETE SET NULL,
  offered_week_start TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'WITHDRAWN', 'NOT_SELECTED', 'INVALIDATED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX brakkevakt_proposal_one_open ON brakkevakt_swap_proposals(request_id, proposer_user_id) WHERE status = 'OPEN';
-- statement-breakpoint
CREATE INDEX brakkevakt_proposal_request ON brakkevakt_swap_proposals(request_id, created_at, id);
-- statement-breakpoint
CREATE TABLE brakkevakt_swap_reservations (
  assignment_id TEXT PRIMARY KEY REFERENCES brakkevakt_assignments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL REFERENCES brakkevakt_swap_requests(id) ON DELETE RESTRICT,
  proposal_id TEXT REFERENCES brakkevakt_swap_proposals(id) ON DELETE SET NULL
);
-- statement-breakpoint
CREATE INDEX brakkevakt_reservations_request ON brakkevakt_swap_reservations(request_id);
-- statement-breakpoint
CREATE TABLE brakkevakt_swap_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES brakkevakt_swap_requests(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('REQUEST_CREATED', 'REQUEST_CANCELLED', 'REQUEST_INVALIDATED', 'PROPOSAL_CREATED', 'PROPOSAL_WITHDRAWN', 'PROPOSAL_INVALIDATED', 'PROPOSAL_ACCEPTED')),
  proposal_id TEXT REFERENCES brakkevakt_swap_proposals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX brakkevakt_swap_events_request ON brakkevakt_swap_events(request_id, created_at);
-- statement-breakpoint
CREATE TABLE brakkevakt_schedule_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  period_id TEXT,
  week_start TEXT NOT NULL,
  assignment_id TEXT,
  old_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  new_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('PERIOD_CREATED', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_CHANGED', 'PERIOD_REMOVED')),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE TRIGGER brakkevakt_schedule_events_no_update BEFORE UPDATE ON brakkevakt_schedule_events
BEGIN SELECT RAISE(ABORT, 'brakkevakt_schedule_audit_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER brakkevakt_schedule_events_no_delete BEFORE DELETE ON brakkevakt_schedule_events
BEGIN SELECT RAISE(ABORT, 'brakkevakt_schedule_audit_immutable'); END;
-- statement-breakpoint
CREATE TABLE brakkevakt_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CONSTRAINT brakkevakt_guard CHECK (revision >= 0),
  deleting_period_id TEXT
);
-- statement-breakpoint
INSERT INTO brakkevakt_state VALUES (1, 0, NULL);
