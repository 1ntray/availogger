-- Additive overlay: raw FlightLogger assignments and accepted agreements stay intact.
CREATE INDEX duty_ops_swap_requests_accepted ON duty_ops_swap_requests(accepted_at, id) WHERE status = 'ACCEPTED';
-- statement-breakpoint
-- Each accepted agreement removes one membership and adds one membership per leg.
-- Last effect on a membership wins. This is an idempotent replay, even when the
-- FlightLogger snapshot has caught up to an intermediate or final portal state.
CREATE VIEW duty_ops_assignment_effects AS
SELECT r.id AS exchange_id, r.accepted_at, r.requested_shift_id AS shift_id,
  r.requester_user_id AS user_id, 0 AS assigned
FROM duty_ops_swap_requests r WHERE r.status = 'ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL
SELECT r.id, r.accepted_at, r.requested_shift_id, r.accepted_by_user_id, 1
FROM duty_ops_swap_requests r WHERE r.status = 'ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL
SELECT r.id, r.accepted_at, p.offered_shift_id, p.proposer_user_id, 0
FROM duty_ops_swap_requests r JOIN duty_ops_swap_proposals p ON p.id = r.accepted_proposal_id
WHERE r.status = 'ACCEPTED' AND r.type = 'DIRECT_SWAP' AND p.offered_shift_id IS NOT NULL
UNION ALL
SELECT r.id, r.accepted_at, p.offered_shift_id, r.requester_user_id, 1
FROM duty_ops_swap_requests r JOIN duty_ops_swap_proposals p ON p.id = r.accepted_proposal_id
WHERE r.status = 'ACCEPTED' AND r.type = 'DIRECT_SWAP' AND p.offered_shift_id IS NOT NULL;
-- statement-breakpoint
CREATE VIEW duty_ops_effective_assignments AS
WITH latest AS (
  SELECT e.shift_id, e.user_id, e.assigned, COALESCE(u.flightlogger_user_id, 'portal:' || u.id) AS identity,
    ROW_NUMBER() OVER (PARTITION BY e.shift_id, COALESCE(u.flightlogger_user_id, 'portal:' || u.id)
      ORDER BY e.accepted_at DESC, e.exchange_id DESC) AS position
  FROM duty_ops_assignment_effects e JOIN users u ON u.id = e.user_id
)
SELECT a.shift_id, a.user_id FROM duty_ops_assignments a JOIN users u ON u.id = a.user_id
WHERE NOT EXISTS (SELECT 1 FROM latest e WHERE e.shift_id = a.shift_id AND e.identity = COALESCE(u.flightlogger_user_id, 'portal:' || u.id))
UNION ALL
SELECT shift_id, user_id FROM latest WHERE position = 1 AND assigned = 1;
-- statement-breakpoint
-- Migrate reservation semantics without unlocking v1 before new code deploys:
-- legacy accepted rows remain compatibility rows, never active v2 locks.
-- The first successful v2 mutation cleans them up in its guarded D1 batch.
CREATE VIEW duty_ops_active_swap_reservations AS
SELECT l.* FROM duty_ops_swap_reservations l JOIN duty_ops_swap_requests r ON r.id = l.request_id
LEFT JOIN duty_ops_swap_proposals p ON p.id = l.proposal_id
WHERE r.status = 'OPEN' AND (l.proposal_id IS NULL OR p.status = 'OPEN');
