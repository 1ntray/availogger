import type { ExchangeDomain, ExchangeV2StateResponse } from '../../../../shared/exchange-v2';

const root = '/api/exchanges/v2';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

async function responseData(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 403 && object(body) && body.code === 'FORBIDDEN')
    throw new Error('You do not have permission for this exchange.');
  if (response.status === 401 || response.status === 403 || response.redirected)
    throw new Error('Reload the page to sign in again.');
  if (!response.ok) throw new Error(object(body) && typeof body.error === 'string' ? body.error : 'Exchange changed. Refresh and try again.');
  return body;
}

export async function loadExchangeV2(domain: ExchangeDomain, assignmentIds: string[], signal: AbortSignal): Promise<ExchangeV2StateResponse> {
  const unique = [...new Set(assignmentIds)];
  const chunks = unique.length ? Array.from({ length: Math.ceil(unique.length / 100) }, (_, index) => unique.slice(index * 100, (index + 1) * 100)) : [[]];
  const pages: ExchangeV2StateResponse[] = [];
  for (const ids of chunks) {
    const query = new URLSearchParams({ domain });
    if (ids.length) query.set('assignmentIds', ids.join(','));
    const body = await responseData(await fetch(`${root}/intents?${query}`, { signal, credentials: 'same-origin', cache: 'no-store' }));
    if (!object(body) || body.domain !== domain || typeof body.currentUserId !== 'string' || body.timeZone !== 'Europe/Oslo' ||
      !Array.isArray(body.intents) || !Array.isArray(body.candidates) || !Array.isArray(body.assignmentStates) ||
      !body.assignmentStates.every(item => object(item) && typeof item.assignmentId === 'string' &&
        typeof item.relationship === 'string' && Array.isArray(item.availableActions) &&
        Array.isArray(item.relatedIntentIds) && Array.isArray(item.relatedCandidateIds) &&
        Array.isArray(item.requestableSourceAssignmentIds) && Array.isArray(item.requestableSourceAssignments) &&
        Array.isArray(item.offerableIntentIds)))
      throw new Error('Exchange returned an unexpected response.');
    pages.push(body as unknown as ExchangeV2StateResponse);
  }
  const first = pages[0];
  return { ...first, assignmentStates: [...new Map(pages.flatMap(page => page.assignmentStates).map(state => [state.assignmentId, state])).values()] };
}

async function post(path: string, body: object = {}): Promise<void> {
  await responseData(await fetch(`${root}${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
const id = (value: string) => encodeURIComponent(value);
export const exchangeV2 = {
  createIntent: (domain: ExchangeDomain, sourceAssignmentId: string, targetAssignmentIds: string[], allowGiveAway: boolean) =>
    post('/intents', { domain, sourceAssignmentId, targetAssignmentIds, allowGiveAway }),
  cancelIntent: (intentId: string) => post(`/intents/${id(intentId)}/cancel`),
  acceptTarget: (targetId: string) => post(`/targets/${id(targetId)}/accept`),
  createOffer: (intentId: string, assignmentId: string) => post(`/intents/${id(intentId)}/offers`, { assignmentId }),
  withdrawOffer: (offerId: string) => post(`/offers/${id(offerId)}/withdraw`),
  claimGiveAway: (intentId: string) => post(`/intents/${id(intentId)}/claim`),
  generateMatches: (intentId: string) => post(`/intents/${id(intentId)}/matches`),
  confirmCandidate: (candidateId: string) => post(`/candidates/${id(candidateId)}/confirm`),
  declineCandidate: (candidateId: string) => post(`/candidates/${id(candidateId)}/decline`),
};
