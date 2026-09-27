-- Flyvask is independent of Duty Ops. All released migrations remain unchanged.
INSERT INTO permissions VALUES ('flyvask.view', 'View Flyvask'), ('flyvask.swap', 'Swap Flyvask assignments');
-- statement-breakpoint
INSERT INTO role_permissions SELECT id, p.key FROM roles CROSS JOIN permissions p
WHERE roles.key IN ('ADMIN', 'STUDENT') AND p.key IN ('flyvask.view', 'flyvask.swap');
-- statement-breakpoint
CREATE TABLE flyvask_shifts (
  id TEXT PRIMARY KEY,
  flightlogger_booking_id TEXT NOT NULL UNIQUE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
  status TEXT NOT NULL,
  participant_count INTEGER NOT NULL CHECK (participant_count >= 0),
  external_reference TEXT,
  classroom_id TEXT,
  classroom_name TEXT,
  last_synced_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX flyvask_shifts_window ON flyvask_shifts (starts_at, ends_at);
-- statement-breakpoint

CREATE TABLE flyvask_assignments (
  shift_id TEXT NOT NULL REFERENCES flyvask_shifts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (shift_id, user_id)
);
-- statement-breakpoint
CREATE INDEX flyvask_assignments_user ON flyvask_assignments (user_id, shift_id);
-- statement-breakpoint

CREATE TABLE flyvask_sync_state (
  scope TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  token_hash TEXT,
  last_synced_at TEXT NOT NULL
);
-- statement-breakpoint
-- Portal agreements only. No writes to FlightLogger assignment snapshots.
CREATE TABLE flyvask_swap_requests (
  id TEXT PRIMARY KEY NOT NULL,
  requester_user_id TEXT NOT NULL REFERENCES users(id),
  requested_shift_id TEXT REFERENCES flyvask_shifts(id) ON DELETE SET NULL,
  requested_starts_at TEXT NOT NULL,
  requested_ends_at TEXT NOT NULL CHECK (requested_ends_at > requested_starts_at),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'CANCELLED')),
  accepted_by_user_id TEXT REFERENCES users(id),
  accepted_proposal_id TEXT REFERENCES flyvask_swap_proposals(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  CHECK ((status = 'ACCEPTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL)
    OR (status <> 'ACCEPTED' AND accepted_by_user_id IS NULL AND accepted_at IS NULL AND accepted_proposal_id IS NULL)),
  CHECK (status <> 'ACCEPTED' OR accepted_proposal_id IS NOT NULL)
);
-- statement-breakpoint
CREATE INDEX flyvask_swap_requests_owner ON flyvask_swap_requests(requester_user_id, created_at, id);
-- statement-breakpoint
CREATE INDEX flyvask_swap_requests_status ON flyvask_swap_requests(status, created_at, id);
-- statement-breakpoint
CREATE TABLE flyvask_swap_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES flyvask_swap_requests(id),
  proposer_user_id TEXT NOT NULL REFERENCES users(id),
  offered_shift_id TEXT REFERENCES flyvask_shifts(id) ON DELETE SET NULL,
  offered_starts_at TEXT NOT NULL,
  offered_ends_at TEXT NOT NULL CHECK (offered_ends_at > offered_starts_at),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'WITHDRAWN', 'NOT_SELECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX flyvask_swap_proposals_request ON flyvask_swap_proposals(request_id, created_at, id);
-- statement-breakpoint
CREATE INDEX flyvask_swap_proposals_owner ON flyvask_swap_proposals(proposer_user_id, request_id);
-- statement-breakpoint
CREATE UNIQUE INDEX flyvask_swap_proposals_one_open ON flyvask_swap_proposals(request_id, proposer_user_id) WHERE status = 'OPEN';
-- statement-breakpoint
-- Reservations protect OPEN intent only; acceptance releases every request lock.
CREATE TABLE flyvask_swap_reservations (
  user_id TEXT NOT NULL REFERENCES users(id),
  shift_id TEXT NOT NULL REFERENCES flyvask_shifts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES flyvask_swap_requests(id),
  proposal_id TEXT REFERENCES flyvask_swap_proposals(id),
  PRIMARY KEY (user_id, shift_id)
);
-- statement-breakpoint
CREATE INDEX flyvask_swap_reservations_request ON flyvask_swap_reservations(request_id, proposal_id);
-- statement-breakpoint
CREATE TABLE flyvask_swap_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES flyvask_swap_requests(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('REQUEST_CREATED', 'REQUEST_CANCELLED',
    'PROPOSAL_CREATED', 'PROPOSAL_WITHDRAWN', 'PROPOSAL_ACCEPTED')),
  proposal_id TEXT REFERENCES flyvask_swap_proposals(id),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX flyvask_swap_events_request ON flyvask_swap_events(request_id, created_at, id);
-- statement-breakpoint
-- Named CHECK aborts the entire D1 batch if a transactional predicate fails.
CREATE TABLE flyvask_swap_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CONSTRAINT flyvask_swap_guard CHECK (revision >= 0)
);
-- statement-breakpoint
INSERT INTO flyvask_swap_state VALUES (1, 0);

-- statement-breakpoint
-- Additive overlay: raw FlightLogger assignments and accepted agreements stay intact.
CREATE INDEX flyvask_swap_requests_accepted ON flyvask_swap_requests(accepted_at, id) WHERE status = 'ACCEPTED';
-- statement-breakpoint
-- Each accepted agreement removes one membership and adds one membership per leg.
-- Last effect on a membership wins. This is an idempotent replay, even when the
-- FlightLogger snapshot has caught up to an intermediate or final portal state.
CREATE VIEW flyvask_assignment_effects AS
SELECT r.id AS exchange_id, r.accepted_at, r.requested_shift_id AS shift_id,
  r.requester_user_id AS user_id, 0 AS assigned
FROM flyvask_swap_requests r WHERE r.status = 'ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL
SELECT r.id, r.accepted_at, r.requested_shift_id, r.accepted_by_user_id, 1
FROM flyvask_swap_requests r WHERE r.status = 'ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL
SELECT r.id, r.accepted_at, p.offered_shift_id, p.proposer_user_id, 0
FROM flyvask_swap_requests r JOIN flyvask_swap_proposals p ON p.id = r.accepted_proposal_id
WHERE r.status = 'ACCEPTED' AND p.offered_shift_id IS NOT NULL
UNION ALL
SELECT r.id, r.accepted_at, p.offered_shift_id, r.requester_user_id, 1
FROM flyvask_swap_requests r JOIN flyvask_swap_proposals p ON p.id = r.accepted_proposal_id
WHERE r.status = 'ACCEPTED' AND p.offered_shift_id IS NOT NULL;
-- statement-breakpoint
CREATE VIEW flyvask_effective_assignments AS
WITH latest AS (
  SELECT e.shift_id, e.user_id, e.assigned, COALESCE(u.flightlogger_user_id, 'portal:' || u.id) AS identity,
    ROW_NUMBER() OVER (PARTITION BY e.shift_id, COALESCE(u.flightlogger_user_id, 'portal:' || u.id)
      ORDER BY e.accepted_at DESC, e.exchange_id DESC) AS position
  FROM flyvask_assignment_effects e JOIN users u ON u.id = e.user_id
)
SELECT a.shift_id, a.user_id FROM flyvask_assignments a JOIN users u ON u.id = a.user_id
WHERE NOT EXISTS (SELECT 1 FROM latest e WHERE e.shift_id = a.shift_id AND e.identity = COALESCE(u.flightlogger_user_id, 'portal:' || u.id))
UNION ALL
SELECT shift_id, user_id FROM latest WHERE position = 1 AND assigned = 1;
-- statement-breakpoint
-- Only OPEN requests/proposals reserve an effective membership.
CREATE VIEW flyvask_active_swap_reservations AS
SELECT l.* FROM flyvask_swap_reservations l JOIN flyvask_swap_requests r ON r.id = l.request_id
LEFT JOIN flyvask_swap_proposals p ON p.id = l.proposal_id
WHERE r.status = 'OPEN' AND (l.proposal_id IS NULL OR p.status = 'OPEN');

-- statement-breakpoint
-- Account replacement invalidates only this user's source snapshot, including
-- replacements made by the previous application during migration-before-deploy.
CREATE TRIGGER flyvask_connection_changed AFTER UPDATE OF flightlogger_user_id ON users
BEGIN
  DELETE FROM flyvask_assignments WHERE user_id = NEW.id AND OLD.flightlogger_user_id IS NOT NEW.flightlogger_user_id;
  DELETE FROM flyvask_sync_state WHERE user_id = NEW.id;
END;
