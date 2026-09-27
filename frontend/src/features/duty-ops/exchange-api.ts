import type { ExchangeHistoryResponse, ExchangesResponse } from '../../../../shared/duty-ops-swaps';
export type { ExchangeRequest, ExchangeProposal, ExchangeShift, ExchangeUser, ExchangesResponse } from '../../../../shared/duty-ops-swaps';
const base = '/api/duty-ops/swaps';
async function responseData(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 403 && body && typeof body === 'object' && 'code' in body && body.code === 'FORBIDDEN') throw new Error('You do not have permission for this Duty Ops operation.');
  if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('Reload the page to sign in again.');
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Exchange could not be saved. Try again.');
  return body;
}
export async function loadExchanges(signal: AbortSignal, cursor?: string): Promise<ExchangesResponse> {
  const body = await responseData(await fetch(`${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal, credentials: 'same-origin', cache: 'no-store' }));
  if (!body || typeof body !== 'object' || !('requests' in body) || !Array.isArray(body.requests) ||
      !('currentUserId' in body) || typeof body.currentUserId !== 'string' || !('lockedShiftIds' in body) || !Array.isArray(body.lockedShiftIds) ||
      !('nextCursor' in body) || (body.nextCursor !== null && typeof body.nextCursor !== 'string')) throw new Error('Shift exchange returned an unexpected response.');
  return body as ExchangesResponse;
}
export async function saveExchange(path: string, body: object = {}): Promise<void> {
  await responseData(await fetch(`${base}${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
export async function loadSwapHistory(signal: AbortSignal, cursor?: string): Promise<ExchangeHistoryResponse> {
  const body = await responseData(await fetch(`${base}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal, credentials: 'same-origin', cache: 'no-store' }));
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const shift = (v: unknown) => v === null || (object(v) && (v.id === null || typeof v.id === 'string') && time(v.startsAt) && time(v.endsAt));
  if (!object(body) || !Array.isArray(body.entries) || (body.nextCursor !== null && typeof body.nextCursor !== 'string') ||
      !body.entries.every(e => object(e) && typeof e.id === 'string' && ['GIVE_AWAY', 'DIRECT_SWAP'].includes(e.type as string) &&
        time(e.acceptedAt) && object(e.counterparty) && typeof e.counterparty.id === 'string' &&
        [e.counterparty.firstName, e.counterparty.lastName].every(n => n === null || typeof n === 'string') &&
        shift(e.givenShift) && shift(e.receivedShift) && (e.type === 'DIRECT_SWAP' ? !!e.givenShift && !!e.receivedShift : !!e.givenShift !== !!e.receivedShift))) {
    throw new Error('Swap history returned an unexpected response.');
  }
  return body as unknown as ExchangeHistoryResponse;
}
