-- Exchange v2 is additive. Accepted v1 agreements and open v1 workflows stay intact.
INSERT INTO permissions VALUES ('admin.exchange_audit', 'Read Exchange audit');
-- statement-breakpoint
INSERT INTO role_permissions SELECT r.id, 'admin.exchange_audit' FROM roles r WHERE r.key = 'ADMIN';
-- statement-breakpoint
CREATE TABLE exchange_v2_intents (
  id TEXT PRIMARY KEY NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK','BRAKKEVAKT')),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_assignment_id TEXT NOT NULL,
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  source_version TEXT NOT NULL,
  allow_give_away INTEGER NOT NULL DEFAULT 0 CHECK(allow_give_away IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('OPEN','COMPLETED','CANCELLED','SUPERSEDED','INVALIDATED','EXPIRED')),
  reason TEXT,
  completed_candidate_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX exchange_v2_intents_open ON exchange_v2_intents(domain,status,created_at,id);
-- statement-breakpoint
CREATE INDEX exchange_v2_intents_owner ON exchange_v2_intents(owner_user_id,status,created_at);
-- statement-breakpoint
CREATE TABLE exchange_v2_targets (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES exchange_v2_intents(id) ON DELETE RESTRICT,
  assignment_id TEXT NOT NULL,
  assignment_snapshot TEXT NOT NULL CHECK(json_valid(assignment_snapshot)),
  assignment_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','COMPLETED','WITHDRAWN','SUPERSEDED','INVALIDATED','EXPIRED')),
  reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(intent_id,assignment_id)
);
-- statement-breakpoint
CREATE INDEX exchange_v2_targets_assignment ON exchange_v2_targets(assignment_id,status,intent_id);
-- statement-breakpoint
CREATE TABLE exchange_v2_offers (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES exchange_v2_intents(id) ON DELETE RESTRICT,
  offerer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_id TEXT NOT NULL,
  assignment_snapshot TEXT NOT NULL CHECK(json_valid(assignment_snapshot)),
  assignment_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','COMPLETED','WITHDRAWN','DECLINED','SUPERSEDED','INVALIDATED','EXPIRED')),
  reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX exchange_v2_offer_open_unique ON exchange_v2_offers(intent_id,offerer_user_id,assignment_id) WHERE status='OPEN';
-- statement-breakpoint
CREATE INDEX exchange_v2_offers_owner ON exchange_v2_offers(offerer_user_id,status,created_at);
-- statement-breakpoint
CREATE TABLE exchange_v2_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK','BRAKKEVAKT')),
  intent_id TEXT NOT NULL REFERENCES exchange_v2_intents(id) ON DELETE RESTRICT,
  offer_id TEXT REFERENCES exchange_v2_offers(id) ON DELETE RESTRICT,
  target_id TEXT REFERENCES exchange_v2_targets(id) ON DELETE RESTRICT,
  match_key TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('WAITING','COMPLETED','DECLINED','SUPERSEDED','INVALIDATED','EXPIRED')),
  reason TEXT,
  caused_by_candidate_id TEXT REFERENCES exchange_v2_candidates(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
-- statement-breakpoint
CREATE INDEX exchange_v2_candidates_intent ON exchange_v2_candidates(intent_id,status,created_at);
-- statement-breakpoint
CREATE TABLE exchange_v2_candidate_intents (
  candidate_id TEXT NOT NULL REFERENCES exchange_v2_candidates(id) ON DELETE RESTRICT,
  intent_id TEXT NOT NULL REFERENCES exchange_v2_intents(id) ON DELETE RESTRICT,
  PRIMARY KEY(candidate_id,intent_id)
);
-- statement-breakpoint
CREATE TABLE exchange_v2_candidate_legs (
  candidate_id TEXT NOT NULL REFERENCES exchange_v2_candidates(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  give_assignment_id TEXT,
  receive_assignment_id TEXT,
  give_version TEXT,
  receive_version TEXT,
  give_snapshot TEXT CHECK(give_snapshot IS NULL OR json_valid(give_snapshot)),
  receive_snapshot TEXT CHECK(receive_snapshot IS NULL OR json_valid(receive_snapshot)),
  consent_source TEXT CHECK(consent_source IN ('TARGET','OFFER','GIVE_AWAY','CLAIM','CONFIRMATION')),
  consented_at TEXT,
  PRIMARY KEY(candidate_id,user_id),
  CHECK(give_assignment_id IS NOT NULL OR receive_assignment_id IS NOT NULL),
  CHECK((consent_source IS NULL) = (consented_at IS NULL))
);
-- statement-breakpoint
CREATE INDEX exchange_v2_legs_give ON exchange_v2_candidate_legs(give_assignment_id,candidate_id);
-- statement-breakpoint
CREATE INDEX exchange_v2_legs_receive ON exchange_v2_candidate_legs(receive_assignment_id,candidate_id);
-- statement-breakpoint
CREATE TABLE exchange_v2_events (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT REFERENCES exchange_v2_intents(id) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES exchange_v2_candidates(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  reason TEXT,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=12000),
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX exchange_v2_events_case ON exchange_v2_events(intent_id,created_at,id);
-- statement-breakpoint
CREATE TRIGGER exchange_v2_events_immutable_update BEFORE UPDATE ON exchange_v2_events
BEGIN SELECT RAISE(ABORT,'exchange_v2_event_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER exchange_v2_events_immutable_delete BEFORE DELETE ON exchange_v2_events
BEGIN SELECT RAISE(ABORT,'exchange_v2_event_immutable'); END;
-- statement-breakpoint
CREATE TABLE exchange_v2_assignment_effects (
  candidate_id TEXT NOT NULL REFERENCES exchange_v2_candidates(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK')),
  assignment_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned INTEGER NOT NULL CHECK(assigned IN (0,1)),
  completed_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id,assignment_id,user_id,assigned)
);
-- statement-breakpoint
CREATE INDEX exchange_v2_effect_membership ON exchange_v2_assignment_effects(domain,assignment_id,user_id,completed_at);
-- statement-breakpoint
CREATE TABLE exchange_v2_credit_entries (
  candidate_id TEXT NOT NULL REFERENCES exchange_v2_candidates(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK(amount IN (-1,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id,user_id)
);
-- statement-breakpoint
CREATE TRIGGER exchange_v2_credit_immutable_update BEFORE UPDATE ON exchange_v2_credit_entries
BEGIN SELECT RAISE(ABORT,'exchange_v2_credit_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER exchange_v2_credit_immutable_delete BEFORE DELETE ON exchange_v2_credit_entries
BEGIN SELECT RAISE(ABORT,'exchange_v2_credit_immutable'); END;
-- statement-breakpoint
CREATE TABLE exchange_v2_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CONSTRAINT exchange_v2_guard CHECK(revision>=0)
);
-- statement-breakpoint
INSERT INTO exchange_v2_state VALUES (1,0);
-- statement-breakpoint
-- Recreate only views. The old accepted rows remain the first four branches.
DROP VIEW duty_ops_effective_assignments;
-- statement-breakpoint
DROP VIEW duty_ops_assignment_effects;
-- statement-breakpoint
CREATE VIEW duty_ops_assignment_effects AS
SELECT r.id exchange_id,r.accepted_at,r.requested_shift_id shift_id,r.requester_user_id user_id,0 assigned
FROM duty_ops_swap_requests r WHERE r.status='ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL SELECT r.id,r.accepted_at,r.requested_shift_id,r.accepted_by_user_id,1
FROM duty_ops_swap_requests r WHERE r.status='ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL SELECT r.id,r.accepted_at,p.offered_shift_id,p.proposer_user_id,0
FROM duty_ops_swap_requests r JOIN duty_ops_swap_proposals p ON p.id=r.accepted_proposal_id
WHERE r.status='ACCEPTED' AND r.type='DIRECT_SWAP' AND p.offered_shift_id IS NOT NULL
UNION ALL SELECT r.id,r.accepted_at,p.offered_shift_id,r.requester_user_id,1
FROM duty_ops_swap_requests r JOIN duty_ops_swap_proposals p ON p.id=r.accepted_proposal_id
WHERE r.status='ACCEPTED' AND r.type='DIRECT_SWAP' AND p.offered_shift_id IS NOT NULL
UNION ALL SELECT 'v2:'||candidate_id,completed_at,assignment_id,user_id,assigned
FROM exchange_v2_assignment_effects WHERE domain='DUTY_OPS';
-- statement-breakpoint
CREATE VIEW duty_ops_effective_assignments AS
WITH latest AS (
 SELECT e.shift_id,e.user_id,e.assigned,COALESCE(u.flightlogger_user_id,'portal:'||u.id) identity,
 ROW_NUMBER() OVER(PARTITION BY e.shift_id,COALESCE(u.flightlogger_user_id,'portal:'||u.id)
 ORDER BY e.accepted_at DESC,e.exchange_id DESC) position
 FROM duty_ops_assignment_effects e JOIN users u ON u.id=e.user_id
)
SELECT a.shift_id,a.user_id FROM duty_ops_assignments a JOIN users u ON u.id=a.user_id
WHERE NOT EXISTS(SELECT 1 FROM latest e WHERE e.shift_id=a.shift_id AND e.identity=COALESCE(u.flightlogger_user_id,'portal:'||u.id))
UNION ALL SELECT shift_id,user_id FROM latest WHERE position=1 AND assigned=1;
-- statement-breakpoint
DROP VIEW flyvask_effective_assignments;
-- statement-breakpoint
DROP VIEW flyvask_assignment_effects;
-- statement-breakpoint
CREATE VIEW flyvask_assignment_effects AS
SELECT r.id exchange_id,r.accepted_at,r.requested_shift_id shift_id,r.requester_user_id user_id,0 assigned
FROM flyvask_swap_requests r WHERE r.status='ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL SELECT r.id,r.accepted_at,r.requested_shift_id,r.accepted_by_user_id,1
FROM flyvask_swap_requests r WHERE r.status='ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL SELECT r.id,r.accepted_at,p.offered_shift_id,p.proposer_user_id,0
FROM flyvask_swap_requests r JOIN flyvask_swap_proposals p ON p.id=r.accepted_proposal_id
WHERE r.status='ACCEPTED' AND p.offered_shift_id IS NOT NULL
UNION ALL SELECT r.id,r.accepted_at,p.offered_shift_id,r.requester_user_id,1
FROM flyvask_swap_requests r JOIN flyvask_swap_proposals p ON p.id=r.accepted_proposal_id
WHERE r.status='ACCEPTED' AND p.offered_shift_id IS NOT NULL
UNION ALL SELECT 'v2:'||candidate_id,completed_at,assignment_id,user_id,assigned
FROM exchange_v2_assignment_effects WHERE domain='FLYVASK';
-- statement-breakpoint
CREATE VIEW flyvask_effective_assignments AS
WITH latest AS (
 SELECT e.shift_id,e.user_id,e.assigned,COALESCE(u.flightlogger_user_id,'portal:'||u.id) identity,
 ROW_NUMBER() OVER(PARTITION BY e.shift_id,COALESCE(u.flightlogger_user_id,'portal:'||u.id)
 ORDER BY e.accepted_at DESC,e.exchange_id DESC) position
 FROM flyvask_assignment_effects e JOIN users u ON u.id=e.user_id
)
SELECT a.shift_id,a.user_id FROM flyvask_assignments a JOIN users u ON u.id=a.user_id
WHERE NOT EXISTS(SELECT 1 FROM latest e WHERE e.shift_id=a.shift_id AND e.identity=COALESCE(u.flightlogger_user_id,'portal:'||u.id))
UNION ALL SELECT shift_id,user_id FROM latest WHERE position=1 AND assigned=1;
-- statement-breakpoint
DROP VIEW duty_ops_credit_balances;
-- statement-breakpoint
DROP VIEW duty_ops_credit_stats;
-- statement-breakpoint
CREATE VIEW duty_ops_credit_stats AS
WITH entries AS (
 SELECT user_id,amount FROM duty_ops_credit_transactions
 UNION ALL SELECT user_id,amount FROM exchange_v2_credit_entries
)
SELECT a.identity,COALESCE(SUM(t.amount),0) balance,
 SUM(CASE WHEN t.amount=1 THEN 1 ELSE 0 END) covered_count,
 SUM(CASE WHEN t.amount=-1 THEN 1 ELSE 0 END) received_count
FROM duty_ops_credit_accounts a LEFT JOIN entries t ON t.user_id=a.user_id GROUP BY a.identity;
-- statement-breakpoint
CREATE VIEW duty_ops_credit_balances AS
SELECT a.user_id,a.identity,s.balance,s.covered_count,s.received_count
FROM duty_ops_credit_accounts a JOIN duty_ops_credit_stats s ON s.identity=a.identity;
