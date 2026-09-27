import type { ExchangeShift, ExchangeUser } from './duty-ops-swaps';
export interface CreditSummary { balance: number; coveredCount: number; receivedCount: number }
export interface CreditHistoryEntry {
  id: string; amount: -1 | 1; reason: 'DUTY_OPS_COVERAGE'; exchangeRequestId: string;
  counterparty: ExchangeUser; shift: ExchangeShift; createdAt: string;
}
export interface CreditsResponse extends CreditSummary { entries: CreditHistoryEntry[]; nextCursor: string | null }
export interface CreditStanding extends CreditSummary { student: ExchangeUser }
export interface CreditStandingsResponse { topContributors: CreditStanding[]; students: CreditStanding[] }
