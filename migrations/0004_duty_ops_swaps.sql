-- Portal agreements only. No writes to FlightLogger assignment snapshots.
CREATE TABLE duty_ops_swap_requests (
  id TEXT PRIMARY KEY NOT NULL,
  requester_user_id TEXT NOT NULL REFERENCES users(id),
  requested_shift_id TEXT REFERENCES duty_ops_shifts(id) ON DELETE SET NULL,
  requested_starts_at TEXT NOT NULL,
  requested_ends_at TEXT NOT NULL CHECK (requested_ends_at > requested_starts_at),
  type TEXT NOT NULL CHECK (type IN ('GIVE_AWAY', 'DIRECT_SWAP')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'CANCELLED')),
  accepted_by_user_id TEXT REFERENCES users(id),
  accepted_proposal_id TEXT REFERENCES duty_ops_swap_proposals(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  CHECK ((status = 'ACCEPTED' AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL)
    OR (status <> 'ACCEPTED' AND accepted_by_user_id IS NULL AND accepted_at IS NULL AND accepted_proposal_id IS NULL)),
  CHECK (status <> 'ACCEPTED' OR (type = 'GIVE_AWAY' AND accepted_proposal_id IS NULL)
    OR (type = 'DIRECT_SWAP' AND accepted_proposal_id IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX duty_ops_swap_requests_owner ON duty_ops_swap_requests(requester_user_id, created_at, id);
-- statement-breakpoint
CREATE INDEX duty_ops_swap_requests_status ON duty_ops_swap_requests(status, created_at, id);
-- statement-breakpoint
CREATE TABLE duty_ops_swap_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES duty_ops_swap_requests(id),
  proposer_user_id TEXT NOT NULL REFERENCES users(id),
  offered_shift_id TEXT REFERENCES duty_ops_shifts(id) ON DELETE SET NULL,
  offered_starts_at TEXT NOT NULL,
  offered_ends_at TEXT NOT NULL CHECK (offered_ends_at > offered_starts_at),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'WITHDRAWN', 'NOT_SELECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX duty_ops_swap_proposals_request ON duty_ops_swap_proposals(request_id, created_at, id);
-- statement-breakpoint
CREATE INDEX duty_ops_swap_proposals_owner ON duty_ops_swap_proposals(proposer_user_id, request_id);
-- statement-breakpoint
CREATE UNIQUE INDEX duty_ops_swap_proposals_one_open ON duty_ops_swap_proposals(request_id, proposer_user_id) WHERE status = 'OPEN';
-- statement-breakpoint
-- Reservations protect both offered assignments and accepted incoming shifts.
-- Accepted reservations are retained: v1 cannot chain unapplied agreements.
CREATE TABLE duty_ops_swap_reservations (
  user_id TEXT NOT NULL REFERENCES users(id),
  shift_id TEXT NOT NULL REFERENCES duty_ops_shifts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES duty_ops_swap_requests(id),
  proposal_id TEXT REFERENCES duty_ops_swap_proposals(id),
  PRIMARY KEY (user_id, shift_id)
);
-- statement-breakpoint
CREATE INDEX duty_ops_swap_reservations_request ON duty_ops_swap_reservations(request_id, proposal_id);
-- statement-breakpoint
CREATE TABLE duty_ops_swap_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES duty_ops_swap_requests(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('REQUEST_CREATED', 'REQUEST_CANCELLED', 'GIVE_AWAY_CLAIMED',
    'PROPOSAL_CREATED', 'PROPOSAL_WITHDRAWN', 'PROPOSAL_ACCEPTED')),
  proposal_id TEXT REFERENCES duty_ops_swap_proposals(id),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX duty_ops_swap_events_request ON duty_ops_swap_events(request_id, created_at, id);
-- statement-breakpoint
-- Named CHECK aborts the entire D1 batch if a transactional predicate fails.
CREATE TABLE duty_ops_swap_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CONSTRAINT duty_ops_swap_guard CHECK (revision >= 0)
);
-- statement-breakpoint
INSERT INTO duty_ops_swap_state VALUES (1, 0);
