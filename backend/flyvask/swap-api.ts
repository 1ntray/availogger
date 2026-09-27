import { methodNotAllowed, withAuthorizedUser } from '../application-api';
import { ApplicationError } from '../application-error';
import type { AccessData, PagesEnv } from '../env';
import { getFlightLoggerCredential } from '../flightlogger-credentials';
import { json } from '../response';
import { requireSameOrigin } from '../same-origin';
import { PERMISSIONS } from '../../shared/authorization';
import { loadFlyvask } from './service';
import { flyvaskWindow } from './window';
import { listSwapHistory } from './swap-history';
import { acceptProposal, cancelExchange, createExchange, createProposal, exchangeId, listExchanges, withdrawProposal } from './swaps';

type Context = { request: Request; env: PagesEnv; data: AccessData; params: Record<string, string | string[]> };
type Action = 'requests' | 'history' | 'cancel' | 'propose' | 'accept' | 'withdraw';
const invalid = () => new ApplicationError('Submit only the required exchange fields.', 400, 'INVALID_EXCHANGE');
async function body(request: Request, fields: string[]) {
  requireSameOrigin(request);
  if (new URL(request.url).search) throw invalid();
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApplicationError('Submit exchange changes as JSON.', 415);
  if (Number(request.headers.get('Content-Length')) > 2048) throw new ApplicationError('Exchange request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new ApplicationError('Exchange request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== fields.length ||
      !fields.every(key => Object.hasOwn(parsed, key))) throw invalid();
  return parsed as Record<string, unknown>;
}
export function exchangeEndpoint(context: Context, action: Action): Promise<Response> | Response {
  const list = (action === 'requests' || action === 'history') && context.request.method === 'GET';
  if (action === 'history' && !list) return methodNotAllowed('GET');
  if (!list && context.request.method !== 'POST') return methodNotAllowed(action === 'requests' ? 'GET, POST' : 'POST');
  return withAuthorizedUser(context, list ? PERMISSIONS.flyvaskView : PERMISSIONS.flyvaskSwap, async (db, user) => {
    if (list) {
      const url = new URL(context.request.url);
      if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1) throw invalid();
      return json(action === 'history' ? await listSwapHistory(db, user, url.searchParams.get('cursor')) : await listExchanges(db, user, url.searchParams.get('cursor')));
    }
    const fields = action === 'requests' ? ['shiftId', 'startsAt', 'endsAt'] : action === 'propose' ? ['shiftId', 'startsAt', 'endsAt'] : [];
    const submitted = await body(context.request, fields);
    const id = action === 'requests' ? '' : exchangeId(context.params.requestId);
    const proposalId = action === 'accept' || action === 'withdraw' ? exchangeId(context.params.proposalId) : '';
    const shiftId = action === 'requests' || action === 'propose' ? exchangeId(submitted.shiftId) : '';
    const expected = { startsAt: submitted.startsAt as string, endsAt: submitted.endsAt as string };
    if (action === 'requests' || action === 'propose') {
      for (const value of [expected.startsAt, expected.endsAt]) {
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid();
      }
      if (expected.startsAt >= expected.endsAt) throw invalid();
    }
    if (action !== 'cancel' && action !== 'withdraw') {
      // Only decrypt the actor's credential. Honor the existing five-minute TTL,
      // but fail closed on stale refreshes for consent operations. Leave Free
      // subrequest headroom for the swap transaction and Access/D1 lookups.
      const token = await getFlightLoggerCredential(db, user.id, context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
      const synchronized = await loadFlyvask(db, user, token, flyvaskWindow(new URL(context.request.url.split('?')[0])), 15);
      if (synchronized.sync.stale) throw new ApplicationError('Refresh Flyvask before exchanging a shift. Try again shortly.', 503, 'EXCHANGE_STALE');
      const target = action === 'requests' ? shiftId : await db.prepare('SELECT requested_shift_id FROM flyvask_swap_requests WHERE id = ?').bind(id).first<string>('requested_shift_id');
      if (!synchronized.shifts.some(s => s.id === target) || (action === 'propose' && !synchronized.shifts.some(s => s.id === shiftId))) {
        throw new ApplicationError('Choose a shift from the current Flyvask window.', 409, 'EXCHANGE_CONFLICT');
      }
    }
    const result = action === 'requests' ? await createExchange(db, user, shiftId, expected)

      : action === 'propose' ? await createProposal(db, user, id, shiftId, expected)
      : action === 'accept' ? await acceptProposal(db, user, id, proposalId)
      : action === 'cancel' ? await cancelExchange(db, user, id) : await withdrawProposal(db, user, id, proposalId);
    return json(result, action === 'requests' || action === 'propose' ? 201 : 200);
  });
}
