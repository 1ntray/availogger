import type { BrakkevaktSchedule, BrakkevaktRoster, BrakkevaktSwaps, BrakkevaktSwapHistory } from '../../../../shared/brakkevakt';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const person = (v: unknown) => object(v) && typeof v.id === 'string' && [v.firstName, v.lastName].every(n => n === null || typeof n === 'string');
const week = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const root = '/api/brakkevakt';
async function request(path: string, signal: AbortSignal, method = 'GET', body?: object) {
  let response: Response;
  try { response = await fetch(`${root}${path}`, { method, signal, cache: 'no-store', credentials: 'same-origin',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); }
  catch (cause) { if (signal.aborted) throw cause; throw new Error('Could not reach Brakkevakt. Check your connection.'); }
  const data: unknown = await response.json().catch(() => null);
  if (response.status === 403 && object(data) && data.code === 'FORBIDDEN') throw new Error('You do not have permission for this Brakkevakt operation.');
  if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('Reload the page to sign in again.');
  if (!response.ok) throw new Error(object(data) && typeof data.error === 'string' ? data.error : 'Brakkevakt could not be loaded or saved.');
  return data;
}
export async function loadSchedule(signal: AbortSignal): Promise<BrakkevaktSchedule> {
  const data = await request('', signal);
  if (!object(data) || typeof data.currentUserId !== 'string' || !week(data.currentWeekStart) || !Array.isArray(data.weeks) ||
    !data.weeks.every(w => object(w) && typeof w.id === 'string' && week(w.weekStart) && Number.isSafeInteger(w.revision) && Array.isArray(w.assignments) &&
      w.assignments.length === 2 && w.assignments.every((a, i) => object(a) && typeof a.id === 'string' && a.slot === i + 1 && person(a.user))))
    throw new Error('Brakkevakt returned an unexpected schedule.');
  return data as unknown as BrakkevaktSchedule;
}
export async function loadRoster(signal: AbortSignal): Promise<BrakkevaktRoster> {
  const data = await request('/roster', signal);
  if (!object(data) || !Array.isArray(data.students) || !data.students.every(person)) throw new Error('Brakkevakt returned an unexpected roster.');
  return data as unknown as BrakkevaktRoster;
}
export async function saveWeek(weekStart: string, userIds: [string, string], revision: number | null): Promise<number> {
  const data = await request(`/schedule/${weekStart}`, new AbortController().signal, 'PUT', { userIds, revision });
  if (!object(data) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1) throw new Error('Brakkevakt returned an unexpected revision. Reload the editor.');
  return data.revision as number;
}
export async function removeWeek(weekStart: string, revision: number): Promise<void> {
  await request(`/schedule/${weekStart}`, new AbortController().signal, 'DELETE', { revision });
}
export async function loadSwaps(signal: AbortSignal, cursor?: string): Promise<BrakkevaktSwaps> {
  const data = await request(`/swaps${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
  if (!object(data) || typeof data.currentUserId !== 'string' || !Array.isArray(data.requests) || !Array.isArray(data.lockedAssignmentIds) ||
    !(data.nextCursor === null || typeof data.nextCursor === 'string') || !data.requests.every(r => object(r) &&
      typeof r.id === 'string' && person(r.requester) && week(r.requestedWeekStart) && typeof r.eligible === 'boolean' && Array.isArray(r.proposals)))
    throw new Error('Brakkevakt returned unexpected swaps.');
  return data as unknown as BrakkevaktSwaps;
}
export async function mutateSwap(path: string, body: object = {}): Promise<void> {
  await request(`/swaps${path}`, new AbortController().signal, 'POST', body);
}
export async function loadHistory(signal: AbortSignal, cursor?: string): Promise<BrakkevaktSwapHistory> {
  const data = await request(`/swaps/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
  if (!object(data) || !Array.isArray(data.entries) || !(data.nextCursor === null || typeof data.nextCursor === 'string') ||
    !data.entries.every(e => object(e) && typeof e.id === 'string' && person(e.counterparty) && week(e.givenWeekStart) && week(e.receivedWeekStart) &&
      typeof e.acceptedAt === 'string' && Number.isFinite(Date.parse(e.acceptedAt)))) throw new Error('Brakkevakt returned unexpected history.');
  return data as unknown as BrakkevaktSwapHistory;
}
