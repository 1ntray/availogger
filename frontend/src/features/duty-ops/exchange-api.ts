import type { ExchangesResponse } from '../../../../shared/duty-ops-swaps';
export type { ExchangeRequest, ExchangeProposal, ExchangeShift, ExchangeUser, ExchangesResponse } from '../../../../shared/duty-ops-swaps';
const base = '/api/duty-ops/swaps';
async function responseData(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 403 && body && typeof body === 'object' && 'code' in body && body.code === 'FORBIDDEN') throw new Error('You do not have permission to exchange shifts.');
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
