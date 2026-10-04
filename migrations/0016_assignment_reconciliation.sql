-- A transfer is one existing assignment slot changing holder. Sequence gives
-- v1/v2 acceptances one durable order, including acceptances in the same ms.
CREATE TABLE assignment_transfers (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL CHECK(domain IN ('DUTY_OPS','FLYVASK')),
  shift_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('V1_DUTY_OPS','V1_FLYVASK','V2')),
  source_id TEXT NOT NULL,
  replaced_user_id TEXT NOT NULL,
  replacement_user_id TEXT NOT NULL,
  replaced_identity TEXT NOT NULL,
  replacement_identity TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'CAPTURED' CHECK(provenance IN ('CAPTURED','BACKFILLED')),
  UNIQUE(domain,source_type,source_id,shift_id)
);
-- statement-breakpoint
CREATE INDEX assignment_transfers_shift ON assignment_transfers(domain,shift_id,sequence);
-- statement-breakpoint
CREATE INDEX assignment_transfers_backfill_order ON assignment_transfers(domain,shift_id,accepted_at,provenance);
-- statement-breakpoint
-- Accepted history is authoritative. Future identity values are captured at
-- acceptance; historical backfill uses the current linked identity and records
-- provenance so it is never misrepresented as an acceptance-time snapshot.
CREATE VIEW assignment_transfer_candidates AS
SELECT 'DUTY_OPS' domain,r.requested_shift_id shift_id,'V1_DUTY_OPS' source_type,r.id source_id,
  r.requester_user_id replaced_user_id,r.accepted_by_user_id replacement_user_id,
  COALESCE(g.flightlogger_user_id,'portal:'||g.id) replaced_identity,
  COALESCE(t.flightlogger_user_id,'portal:'||t.id) replacement_identity,r.accepted_at
FROM duty_ops_swap_requests r JOIN users g ON g.id=r.requester_user_id
JOIN users t ON t.id=r.accepted_by_user_id
WHERE r.status='ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL
SELECT 'DUTY_OPS',p.offered_shift_id,'V1_DUTY_OPS',r.id,p.proposer_user_id,r.requester_user_id,
  COALESCE(g.flightlogger_user_id,'portal:'||g.id),COALESCE(t.flightlogger_user_id,'portal:'||t.id),r.accepted_at
FROM duty_ops_swap_requests r JOIN duty_ops_swap_proposals p ON p.id=r.accepted_proposal_id
JOIN users g ON g.id=p.proposer_user_id JOIN users t ON t.id=r.requester_user_id
WHERE r.status='ACCEPTED' AND r.type='DIRECT_SWAP' AND p.offered_shift_id IS NOT NULL
UNION ALL
SELECT 'FLYVASK',r.requested_shift_id,'V1_FLYVASK',r.id,r.requester_user_id,r.accepted_by_user_id,
  COALESCE(g.flightlogger_user_id,'portal:'||g.id),COALESCE(t.flightlogger_user_id,'portal:'||t.id),r.accepted_at
FROM flyvask_swap_requests r JOIN users g ON g.id=r.requester_user_id
JOIN users t ON t.id=r.accepted_by_user_id
WHERE r.status='ACCEPTED' AND r.requested_shift_id IS NOT NULL
UNION ALL
SELECT 'FLYVASK',p.offered_shift_id,'V1_FLYVASK',r.id,p.proposer_user_id,r.requester_user_id,
  COALESCE(g.flightlogger_user_id,'portal:'||g.id),COALESCE(t.flightlogger_user_id,'portal:'||t.id),r.accepted_at
FROM flyvask_swap_requests r JOIN flyvask_swap_proposals p ON p.id=r.accepted_proposal_id
JOIN users g ON g.id=p.proposer_user_id JOIN users t ON t.id=r.requester_user_id
WHERE r.status='ACCEPTED' AND p.offered_shift_id IS NOT NULL
UNION ALL
SELECT e.domain,e.assignment_id,'V2',e.candidate_id,e.user_id,receiver.user_id,
  COALESCE(g.flightlogger_user_id,'portal:'||g.id),COALESCE(t.flightlogger_user_id,'portal:'||t.id),c.completed_at
FROM exchange_v2_assignment_effects e JOIN exchange_v2_assignment_effects receiver
  ON receiver.candidate_id=e.candidate_id AND receiver.domain=e.domain
  AND receiver.assignment_id=e.assignment_id AND receiver.assigned=1
JOIN exchange_v2_candidates c ON c.id=e.candidate_id AND c.status='COMPLETED'
JOIN users g ON g.id=e.user_id JOIN users t ON t.id=receiver.user_id
WHERE e.assigned=0;
-- statement-breakpoint
INSERT OR IGNORE INTO assignment_transfers
  (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,
   replaced_identity,replacement_identity,accepted_at,provenance)
SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,
  replaced_identity,replacement_identity,accepted_at,'BACKFILLED'
FROM assignment_transfer_candidates ORDER BY accepted_at,source_type,source_id,shift_id;
-- statement-breakpoint
CREATE TRIGGER duty_transfer_insert AFTER INSERT ON duty_ops_swap_requests WHEN NEW.status='ACCEPTED'
BEGIN
  INSERT OR IGNORE INTO assignment_transfers
    (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at)
  SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at
  FROM assignment_transfer_candidates WHERE source_type='V1_DUTY_OPS' AND source_id=NEW.id ORDER BY shift_id;
END;
-- statement-breakpoint
CREATE TRIGGER duty_transfer_accept AFTER UPDATE OF status ON duty_ops_swap_requests
WHEN NEW.status='ACCEPTED' AND OLD.status<>'ACCEPTED'
BEGIN
  INSERT OR IGNORE INTO assignment_transfers
    (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at)
  SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at
  FROM assignment_transfer_candidates WHERE source_type='V1_DUTY_OPS' AND source_id=NEW.id ORDER BY shift_id;
END;
-- statement-breakpoint
CREATE TRIGGER flyvask_transfer_insert AFTER INSERT ON flyvask_swap_requests WHEN NEW.status='ACCEPTED'
BEGIN
  INSERT OR IGNORE INTO assignment_transfers
    (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at)
  SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at
  FROM assignment_transfer_candidates WHERE source_type='V1_FLYVASK' AND source_id=NEW.id ORDER BY shift_id;
END;
-- statement-breakpoint
CREATE TRIGGER flyvask_transfer_accept AFTER UPDATE OF status ON flyvask_swap_requests
WHEN NEW.status='ACCEPTED' AND OLD.status<>'ACCEPTED'
BEGIN
  INSERT OR IGNORE INTO assignment_transfers
    (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at)
  SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at
  FROM assignment_transfer_candidates WHERE source_type='V1_FLYVASK' AND source_id=NEW.id ORDER BY shift_id;
END;
-- statement-breakpoint
CREATE TRIGGER v2_transfer_insert AFTER INSERT ON exchange_v2_candidates WHEN NEW.status='COMPLETED'
BEGIN
  INSERT OR IGNORE INTO assignment_transfers
    (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at)
  SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at
  FROM assignment_transfer_candidates WHERE source_type='V2' AND source_id=NEW.id ORDER BY shift_id;
END;
-- statement-breakpoint
CREATE TRIGGER v2_transfer_complete AFTER UPDATE OF status ON exchange_v2_candidates
WHEN NEW.status='COMPLETED' AND OLD.status<>'COMPLETED'
BEGIN
  INSERT OR IGNORE INTO assignment_transfers
    (domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at)
  SELECT domain,shift_id,source_type,source_id,replaced_user_id,replacement_user_id,replaced_identity,replacement_identity,accepted_at
  FROM assignment_transfer_candidates WHERE source_type='V2' AND source_id=NEW.id ORDER BY shift_id;
END;
-- statement-breakpoint
-- History is append-only in production. These cleanup triggers also keep
-- disposable test fixtures coherent when they remove accepted parent rows.
CREATE TRIGGER duty_transfer_delete AFTER DELETE ON duty_ops_swap_requests BEGIN
  DELETE FROM assignment_transfers WHERE source_type='V1_DUTY_OPS' AND source_id=OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER flyvask_transfer_delete AFTER DELETE ON flyvask_swap_requests BEGIN
  DELETE FROM assignment_transfers WHERE source_type='V1_FLYVASK' AND source_id=OLD.id;
END;
-- statement-breakpoint
CREATE TRIGGER v2_transfer_delete AFTER DELETE ON exchange_v2_candidates BEGIN
  DELETE FROM assignment_transfers WHERE source_type='V2' AND source_id=OLD.id;
END;
-- statement-breakpoint
CREATE VIEW assignment_transfer_active AS SELECT * FROM assignment_transfers;
-- statement-breakpoint
CREATE VIEW assignment_transfer_paths AS
WITH RECURSIVE roots AS (
  SELECT t.* FROM assignment_transfer_active t WHERE NOT EXISTS (
    SELECT 1 FROM assignment_transfer_active earlier WHERE earlier.domain=t.domain AND earlier.shift_id=t.shift_id
      AND earlier.replacement_identity=t.replaced_identity AND earlier.sequence<t.sequence)
), walk AS (
  SELECT sequence root_sequence,sequence step_sequence,domain,shift_id,replaced_identity,replacement_identity,
    replacement_user_id,source_id,source_type FROM roots
  UNION ALL
  SELECT walk.root_sequence,next.sequence,next.domain,next.shift_id,next.replaced_identity,next.replacement_identity,
    next.replacement_user_id,next.source_id,next.source_type
  FROM walk JOIN assignment_transfer_active next ON next.domain=walk.domain AND next.shift_id=walk.shift_id
    AND next.replaced_identity=walk.replacement_identity AND next.sequence=(
      SELECT MIN(candidate.sequence) FROM assignment_transfer_active candidate
      WHERE candidate.domain=walk.domain AND candidate.shift_id=walk.shift_id
        AND candidate.replaced_identity=walk.replacement_identity AND candidate.sequence>walk.step_sequence)
)
SELECT * FROM walk;
-- statement-breakpoint
CREATE VIEW assignment_transfer_final AS
SELECT root_sequence,step_sequence,domain,shift_id,replaced_identity,replacement_identity,
  replacement_user_id,source_id,source_type
FROM (SELECT path.*,row_number() OVER (PARTITION BY root_sequence ORDER BY step_sequence DESC) rank
  FROM assignment_transfer_paths path) WHERE rank=1;
-- statement-breakpoint
CREATE VIEW assignment_source_shifts AS
SELECT 'DUTY_OPS' domain,id shift_id,participant_count FROM duty_ops_shifts
UNION ALL SELECT 'FLYVASK',id,participant_count FROM flyvask_shifts;
-- statement-breakpoint
CREATE VIEW assignment_raw_identities AS
SELECT 'DUTY_OPS' domain,a.shift_id,COALESCE(u.flightlogger_user_id,'portal:'||u.id) identity
FROM duty_ops_assignments a JOIN users u ON u.id=a.user_id
UNION SELECT 'FLYVASK',a.shift_id,COALESCE(u.flightlogger_user_id,'portal:'||u.id)
FROM flyvask_assignments a JOIN users u ON u.id=a.user_id;
-- statement-breakpoint
CREATE VIEW assignment_reconciliation AS
WITH roots AS (
  SELECT domain,shift_id,count(*) slot_count,count(DISTINCT replacement_identity) distinct_receivers
  FROM assignment_transfer_final GROUP BY domain,shift_id
), root_sources AS (
  SELECT domain,shift_id,count(DISTINCT replaced_identity) distinct_sources
  FROM assignment_transfer_paths WHERE root_sequence=step_sequence GROUP BY domain,shift_id
), raw AS (
  SELECT domain,shift_id,count(*) identity_count FROM assignment_raw_identities GROUP BY domain,shift_id
), matched AS (
  SELECT f.domain,f.shift_id,count(*) matched_count FROM assignment_transfer_final f
  WHERE EXISTS (SELECT 1 FROM assignment_transfer_paths p JOIN assignment_raw_identities r
    ON r.domain=p.domain AND r.shift_id=p.shift_id
    AND r.identity IN (p.replaced_identity,p.replacement_identity)
    WHERE p.root_sequence=f.root_sequence)
  GROUP BY f.domain,f.shift_id
), unaffected AS (
  SELECT r.domain,r.shift_id,count(*) unaffected_count FROM assignment_raw_identities r
  WHERE NOT EXISTS (SELECT 1 FROM assignment_transfer_paths p WHERE p.domain=r.domain AND p.shift_id=r.shift_id
    AND r.identity IN (p.replaced_identity,p.replacement_identity))
  GROUP BY r.domain,r.shift_id
), ambiguous AS (
  SELECT DISTINCT a.domain,a.shift_id FROM assignment_transfers a JOIN assignment_transfers b
    ON b.domain=a.domain AND b.shift_id=a.shift_id AND b.sequence>a.sequence
    AND a.provenance='BACKFILLED' AND b.provenance='BACKFILLED' AND a.accepted_at=b.accepted_at
    AND (a.replacement_identity=b.replaced_identity OR b.replacement_identity=a.replaced_identity
      OR a.replaced_identity=b.replaced_identity)
), counts AS (
  SELECT s.*,COALESCE(roots.slot_count,0) slot_count,COALESCE(roots.distinct_receivers,0) distinct_receivers,
    COALESCE(root_sources.distinct_sources,0) distinct_sources,
    COALESCE(raw.identity_count,0) raw_count,COALESCE(matched.matched_count,0) matched_count,
    COALESCE(unaffected.unaffected_count,0) unaffected_count,ambiguous.shift_id IS NOT NULL ambiguous_order
  FROM assignment_source_shifts s LEFT JOIN roots ON roots.domain=s.domain AND roots.shift_id=s.shift_id
  LEFT JOIN root_sources ON root_sources.domain=s.domain AND root_sources.shift_id=s.shift_id
  LEFT JOIN raw ON raw.domain=s.domain AND raw.shift_id=s.shift_id
  LEFT JOIN matched ON matched.domain=s.domain AND matched.shift_id=s.shift_id
  LEFT JOIN unaffected ON unaffected.domain=s.domain AND unaffected.shift_id=s.shift_id
  LEFT JOIN ambiguous ON ambiguous.domain=s.domain AND ambiguous.shift_id=s.shift_id
), classified AS (
  SELECT counts.*,
    CASE WHEN raw_count>participant_count THEN 'RAW_IDENTITY_OVERCOUNT'
      WHEN ambiguous_order OR slot_count>participant_count OR distinct_receivers<slot_count OR distinct_sources<slot_count
        THEN 'PORTAL_LINEAGE_UNVERIFIED'
      WHEN matched_count<slot_count OR slot_count+unaffected_count>participant_count THEN 'PORTAL_SOURCE_DIVERGED'
      ELSE NULL END reason
  FROM counts
)
SELECT classified.*,
  CASE WHEN reason IS NOT NULL THEN 'CONFLICT'
    WHEN slot_count+unaffected_count<participant_count THEN 'PARTIAL' ELSE 'CONSISTENT' END status,
  CASE WHEN slot_count=0 THEN 0 WHEN EXISTS (
    SELECT 1 FROM assignment_transfer_final f WHERE f.domain=classified.domain AND f.shift_id=classified.shift_id
    AND (NOT EXISTS (SELECT 1 FROM assignment_raw_identities r WHERE r.domain=f.domain AND r.shift_id=f.shift_id
        AND r.identity=f.replacement_identity)
      OR EXISTS (SELECT 1 FROM assignment_transfer_paths p JOIN assignment_raw_identities r
        ON r.domain=p.domain AND r.shift_id=p.shift_id AND r.identity=p.replaced_identity
        WHERE p.root_sequence=f.root_sequence AND p.replaced_identity<>f.replacement_identity)))
    THEN 1 ELSE 0 END assignments_differ
FROM classified;
-- statement-breakpoint
DROP VIEW duty_ops_effective_assignments;
-- statement-breakpoint
CREATE VIEW duty_ops_candidate_assignments AS
SELECT a.shift_id,a.user_id FROM duty_ops_assignments a JOIN users u ON u.id=a.user_id
WHERE NOT EXISTS (SELECT 1 FROM assignment_transfer_paths p WHERE p.domain='DUTY_OPS' AND p.shift_id=a.shift_id
  AND COALESCE(u.flightlogger_user_id,'portal:'||u.id) IN (p.replaced_identity,p.replacement_identity))
UNION ALL
SELECT f.shift_id,f.replacement_user_id FROM assignment_transfer_final f
WHERE f.domain='DUTY_OPS';
-- statement-breakpoint
CREATE VIEW duty_ops_effective_assignments AS
SELECT c.shift_id,c.user_id FROM duty_ops_candidate_assignments c
JOIN assignment_reconciliation r ON r.domain='DUTY_OPS' AND r.shift_id=c.shift_id
WHERE r.status<>'CONFLICT' OR (r.reason IN ('RAW_IDENTITY_OVERCOUNT','PORTAL_SOURCE_DIVERGED')
  AND EXISTS (SELECT 1 FROM assignment_transfer_final f WHERE f.domain='DUTY_OPS'
    AND f.shift_id=c.shift_id AND f.replacement_user_id=c.user_id));
-- statement-breakpoint
DROP VIEW flyvask_effective_assignments;
-- statement-breakpoint
CREATE VIEW flyvask_candidate_assignments AS
SELECT a.shift_id,a.user_id FROM flyvask_assignments a JOIN users u ON u.id=a.user_id
WHERE NOT EXISTS (SELECT 1 FROM assignment_transfer_paths p WHERE p.domain='FLYVASK' AND p.shift_id=a.shift_id
  AND COALESCE(u.flightlogger_user_id,'portal:'||u.id) IN (p.replaced_identity,p.replacement_identity))
UNION ALL
SELECT f.shift_id,f.replacement_user_id FROM assignment_transfer_final f
WHERE f.domain='FLYVASK';
-- statement-breakpoint
CREATE VIEW flyvask_effective_assignments AS
SELECT c.shift_id,c.user_id FROM flyvask_candidate_assignments c
JOIN assignment_reconciliation r ON r.domain='FLYVASK' AND r.shift_id=c.shift_id
WHERE r.status<>'CONFLICT' OR (r.reason IN ('RAW_IDENTITY_OVERCOUNT','PORTAL_SOURCE_DIVERGED')
  AND EXISTS (SELECT 1 FROM assignment_transfer_final f WHERE f.domain='FLYVASK'
    AND f.shift_id=c.shift_id AND f.replacement_user_id=c.user_id));
