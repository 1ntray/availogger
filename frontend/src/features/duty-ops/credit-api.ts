import type { CreditSummary, CreditsResponse, CreditStandingsResponse } from '../../../../shared/duty-ops-credits';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const person = (v: unknown) => object(v) && typeof v.id === 'string' && [v.firstName, v.lastName].every(name => name === null || typeof name === 'string');
export const creditSign = (balance: number) => balance > 0 ? `+${balance}` : String(balance);
export function isCreditSummary(v: unknown): v is CreditSummary {
  return object(v) && Number.isSafeInteger(v.balance) && Number.isSafeInteger(v.coveredCount) && Number.isSafeInteger(v.receivedCount) &&
    (v.coveredCount as number) >= 0 && (v.receivedCount as number) >= 0 && v.balance === (v.coveredCount as number) - (v.receivedCount as number);
}
async function request(path: string, signal: AbortSignal) {
  let response: Response;
  try { response = await fetch(`/api/duty-ops/credits${path}`, { signal, credentials: 'same-origin', cache: 'no-store' }); }
  catch (cause) { if (signal.aborted) throw cause; throw new Error('Could not reach Duty Ops credits. Check your connection and try again.'); }
  const data: unknown = await response.json().catch(() => null);
  if (response.status === 403 && object(data) && data.code === 'FORBIDDEN') throw new Error('You do not have access to Duty Ops credits.');
  if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('Reload the page to sign in again.');
  if (!response.ok) throw new Error('Duty Ops credits could not be loaded. Try again shortly.');
  return data;
}
export async function loadCreditSummary(signal: AbortSignal): Promise<CreditSummary> {
  const data = await request('?summary=1', signal);
  if (!isCreditSummary(data)) throw new Error('Credits returned an unexpected summary.');
  return { balance: data.balance, coveredCount: data.coveredCount, receivedCount: data.receivedCount };
}
export async function loadCredits(signal: AbortSignal, cursor?: string): Promise<CreditsResponse> {
  const data = await request(cursor ? `?cursor=${encodeURIComponent(cursor)}` : '', signal);
  if (!isCreditSummary(data) || !object(data) || !Array.isArray(data.entries) || (data.nextCursor !== null && typeof data.nextCursor !== 'string') ||
    !data.entries.every(e => object(e) && typeof e.id === 'string' && [1, -1].includes(e.amount as number) && e.reason === 'DUTY_OPS_COVERAGE' &&
      typeof e.exchangeRequestId === 'string' && person(e.counterparty) && time(e.createdAt) && object(e.shift) &&
      (e.shift.id === null || typeof e.shift.id === 'string') && time(e.shift.startsAt) && time(e.shift.endsAt) && e.shift.startsAt < e.shift.endsAt)) {
    throw new Error('Credits returned an unexpected history response.');
  }
  return data as unknown as CreditsResponse;
}
export async function loadCreditStandings(signal: AbortSignal): Promise<CreditStandingsResponse> {
  const data = await request('/standings', signal);
  if (!object(data) || !Array.isArray(data.topContributors) || !Array.isArray(data.students) ||
    ![...data.topContributors, ...data.students].every(row => isCreditSummary(row) && object(row) && person(row.student))) throw new Error('Credits returned unexpected standings.');
  return data as unknown as CreditStandingsResponse;
}
