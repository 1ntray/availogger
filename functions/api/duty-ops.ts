import { methodNotAllowed, withAuthorizedUser } from '../../backend/application-api';
import { PERMISSIONS } from '../../shared/authorization';
import { loadDutyOps } from '../../backend/duty-ops/service';
import { dutyWindow } from '../../backend/duty-ops/window';
import type { AccessData, PagesEnv } from '../../backend/env';
import { getFlightLoggerCredential } from '../../backend/flightlogger-credentials';
import { json } from '../../backend/response';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.dutyOpsView, async (db, user) => {
    const window = dutyWindow(new URL(context.request.url));
    const token = await getFlightLoggerCredential(db, user.id, context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    return json(await loadDutyOps(db, user, token, window));
  });
};
