import { methodNotAllowed, withAuthorizedUser } from '../application-api';
import { ApplicationError } from '../application-error';
import type { AccessData, PagesEnv } from '../env';
import { json } from '../response';
import { PERMISSIONS } from '../../shared/authorization';
import { creditStandings, creditSummary, listCredits, reconcileCoverage } from './credits';
type Context = { request: Request; env: PagesEnv; data: AccessData };
export function creditEndpoint(context: Context, standings = false): Promise<Response> | Response {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, standings ? PERMISSIONS.dutyOpsManageSchedule : PERMISSIONS.dutyOpsView, async (db, actor) => {
    const params = new URL(context.request.url).searchParams;
    if ([...params.keys()].some(key => standings || !['cursor', 'summary'].includes(key)) || params.getAll('cursor').length > 1 || params.getAll('summary').length > 1 ||
      (params.has('summary') && (params.get('summary') !== '1' || params.has('cursor')))) {
      throw new ApplicationError('Use valid credit query parameters.', 400, 'INVALID_CREDIT_REQUEST');
    }
    if (standings) return json(await creditStandings(db));
    if (params.has('summary')) { await reconcileCoverage(db); return json(await creditSummary(db, actor)); }
    return json(await listCredits(db, actor, params.get('cursor')));
  });
}
