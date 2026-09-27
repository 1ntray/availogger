-- Additive ledger. No trigger changes old exchange acceptance or assignment rules.
CREATE TABLE duty_ops_credit_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount IN (-1, 1)),
  reason TEXT NOT NULL CHECK (reason = 'DUTY_OPS_COVERAGE'),
  exchange_request_id TEXT NOT NULL REFERENCES duty_ops_swap_requests(id) ON DELETE RESTRICT,
  counterparty_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (user_id <> counterparty_user_id),
  UNIQUE (exchange_request_id, user_id)
);
-- statement-breakpoint
CREATE INDEX duty_ops_credit_history ON duty_ops_credit_transactions(user_id, created_at DESC, id DESC);
-- statement-breakpoint
CREATE TRIGGER duty_ops_credits_immutable_update BEFORE UPDATE ON duty_ops_credit_transactions
BEGIN SELECT RAISE(ABORT, 'duty_ops_credits_immutable'); END;
-- statement-breakpoint
CREATE TRIGGER duty_ops_credits_immutable_delete BEFORE DELETE ON duty_ops_credit_transactions
BEGIN SELECT RAISE(ABORT, 'duty_ops_credits_immutable'); END;
-- statement-breakpoint
-- Only coverage parties and their accepted consent timestamp can enter this ledger.
-- This does not enforce the operational floor, including during legacy backfill.
CREATE TRIGGER duty_ops_credit_coverage_event BEFORE INSERT ON duty_ops_credit_transactions
WHEN NOT EXISTS (SELECT 1 FROM duty_ops_swap_requests r WHERE r.id = NEW.exchange_request_id
  AND r.type = 'GIVE_AWAY' AND r.status = 'ACCEPTED' AND r.accepted_at = NEW.created_at
  AND ((NEW.user_id = r.requester_user_id AND NEW.counterparty_user_id = r.accepted_by_user_id AND NEW.amount = -1)
    OR (NEW.user_id = r.accepted_by_user_id AND NEW.counterparty_user_id = r.requester_user_id AND NEW.amount = 1)))
BEGIN SELECT RAISE(ABORT, 'duty_ops_credit_event_invalid'); END;
-- statement-breakpoint
-- Shared deterministic source for migration backfill and deployment-window reconciliation.
CREATE VIEW duty_ops_credit_coverage_entries AS
SELECT r.id || ':requester' AS id, r.requester_user_id AS user_id, -1 AS amount, 'DUTY_OPS_COVERAGE' AS reason,
  r.id AS exchange_request_id, r.accepted_by_user_id AS counterparty_user_id, r.accepted_at AS created_at
FROM duty_ops_swap_requests r WHERE r.type = 'GIVE_AWAY' AND r.status = 'ACCEPTED'
UNION ALL
SELECT r.id || ':claimant', r.accepted_by_user_id, 1, 'DUTY_OPS_COVERAGE', r.id, r.requester_user_id, r.accepted_at
FROM duty_ops_swap_requests r WHERE r.type = 'GIVE_AWAY' AND r.status = 'ACCEPTED';
-- statement-breakpoint
INSERT INTO duty_ops_credit_transactions
SELECT e.* FROM duty_ops_credit_coverage_entries e
WHERE NOT EXISTS (SELECT 1 FROM duty_ops_credit_transactions t WHERE t.exchange_request_id = e.exchange_request_id AND t.user_id = e.user_id);
-- statement-breakpoint
-- Existing effective assignments already identify aliases by trusted FlightLogger ID.
-- Use that same identity for balance/floor/stats; never merge accounts by email/name.
CREATE VIEW duty_ops_credit_accounts AS
SELECT id AS user_id, CASE WHEN flightlogger_user_id IS NOT NULL THEN 'flightlogger:' || flightlogger_user_id ELSE 'portal:' || id END AS identity
FROM users;
-- statement-breakpoint
CREATE VIEW duty_ops_credit_stats AS
SELECT a.identity, COALESCE(SUM(t.amount), 0) AS balance,
  SUM(CASE WHEN t.amount = 1 THEN 1 ELSE 0 END) AS covered_count,
  SUM(CASE WHEN t.amount = -1 THEN 1 ELSE 0 END) AS received_count
FROM duty_ops_credit_accounts a LEFT JOIN duty_ops_credit_transactions t ON t.user_id = a.user_id
GROUP BY a.identity;
-- statement-breakpoint
CREATE VIEW duty_ops_credit_balances AS
SELECT a.user_id, a.identity, s.balance, s.covered_count, s.received_count
FROM duty_ops_credit_accounts a JOIN duty_ops_credit_stats s ON s.identity = a.identity;
-- statement-breakpoint
-- Transaction guard only, never a stored balance. Used only by the new application.
CREATE TABLE duty_ops_credit_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CONSTRAINT duty_ops_credit_floor CHECK (revision >= 0)
);
-- statement-breakpoint
INSERT INTO duty_ops_credit_state VALUES (1, 0);
