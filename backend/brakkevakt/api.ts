import { ApplicationError } from '../application-error';
import { methodNotAllowed, withAuthorizedUser } from '../application-api';
import { requireSameOrigin } from '../same-origin';
import { json } from '../response';
import type { AccessData, PagesEnv } from '../env';
import { PERMISSIONS } from '../../shared/authorization';
import { listRoster, listSchedule, removeWeek, saveWeek } from './schedule';
import { acceptSwap, cancelSwap, createSwap, listSwapHistory, listSwaps, proposeSwap, swapId, withdrawSwap } from './swaps';
import { requireWeek } from './week';

type Context = { request: Request; env: PagesEnv; data: AccessData; params: Record<string, string | string[]> };
const invalid = () => new ApplicationError('Submit only the required Brakkevakt fields.', 400, 'INVALID_BRAKKEVAKT_REQUEST');
async function body(request: Request, keys: string[]) {
  requireSameOrigin(request);
  if (new URL(request.url).search) throw invalid();
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new ApplicationError('Submit Brakkevakt changes as JSON.', 415);
  if (Number(request.headers.get('Content-Length')) > 2048) throw new ApplicationError('Request is too large.', 413);
  const reader = request.body?.getReader(); if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 2048) { await reader.cancel(); throw new ApplicationError('Request is too large.', 413); } chunks.push(value);
  } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== keys.length ||
    !keys.every(key => Object.hasOwn(parsed, key))) throw invalid();
  return parsed as Record<string, unknown>;
}
function noQuery(request: Request) { if (new URL(request.url).search) throw invalid(); }
function cursor(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'cursor') || params.getAll('cursor').length > 1) throw invalid();
  return params.get('cursor');
}
export function scheduleEndpoint(context: Context): Promise<Response> | Response {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.brakkevaktView, async (db, actor) => { noQuery(context.request); return json(await listSchedule(db, actor)); });
}
export function rosterEndpoint(context: Context): Promise<Response> | Response {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.brakkevaktManageSchedule, async db => { noQuery(context.request); return json(await listRoster(db)); });
}
export function weekEndpoint(context: Context): Promise<Response> | Response {
  if (context.request.method !== 'PUT' && context.request.method !== 'DELETE') return methodNotAllowed('PUT, DELETE');
  return withAuthorizedUser(context, PERMISSIONS.brakkevaktManageSchedule, async (db, actor) => {
    const week = requireWeek(context.params.weekStart);
    const input = await body(context.request, context.request.method === 'PUT' ? ['userIds', 'revision'] : ['revision']);
    if ((input.revision !== null && (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0)) ||
      (context.request.method === 'DELETE' && input.revision === null)) throw invalid();
    if (context.request.method === 'DELETE') return json(await removeWeek(db, actor, week, input.revision as number));
    if (!Array.isArray(input.userIds) || input.userIds.length !== 2 || input.userIds[0] === input.userIds[1]) throw invalid();
    const userIds = input.userIds.map(swapId) as [string, string];
    return json(await saveWeek(db, actor, week, { userIds, revision: input.revision as number | null }));
  });
}
type SwapAction = 'requests' | 'history' | 'cancel' | 'proposals' | 'withdraw' | 'accept';
export function swapEndpoint(context: Context, action: SwapAction): Promise<Response> | Response {
  const method = action === 'requests' || action === 'history' ? 'GET' : 'POST';
  if (context.request.method !== method && !(action === 'requests' && context.request.method === 'POST'))
    return methodNotAllowed(action === 'requests' ? 'GET, POST' : method);
  const read = context.request.method === 'GET';
  return withAuthorizedUser(context, read ? PERMISSIONS.brakkevaktView : PERMISSIONS.brakkevaktSwap, async (db, actor) => {
    if (read) return json(action === 'history' ? await listSwapHistory(db, actor, cursor(context.request)) : await listSwaps(db, actor, cursor(context.request)));
    const input = await body(context.request, action === 'requests' || action === 'proposals' ? ['assignmentId'] : []);
    const requestId = action === 'requests' ? '' : swapId(context.params.requestId);
    const proposalId = action === 'accept' || action === 'withdraw' ? swapId(context.params.proposalId) : '';
    const assignmentId = action === 'requests' || action === 'proposals' ? swapId(input.assignmentId) : '';
    return json(action === 'requests' ? await createSwap(db, actor, assignmentId) : action === 'proposals' ? await proposeSwap(db, actor, requestId, assignmentId)
      : action === 'accept' ? await acceptSwap(db, actor, requestId, proposalId) : action === 'withdraw' ? await withdrawSwap(db, actor, requestId, proposalId)
        : await cancelSwap(db, actor, requestId), action === 'requests' || action === 'proposals' ? 201 : 200);
  });
}
