import { methodNotAllowed, withAuthorizedUser } from '../../backend/application-api';
import { PERMISSIONS } from '../../shared/authorization';
import { loadFlyvask } from '../../backend/flyvask/service';
import { flyvaskWindow } from '../../backend/flyvask/window';
import type { AccessData, PagesEnv } from '../../backend/env';
import { getFlightLoggerCredential } from '../../backend/flightlogger-credentials';
import { json } from '../../backend/response';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.flyvaskView, async (db, user) => {
    const window = flyvaskWindow(new URL(context.request.url));
    const token = await getFlightLoggerCredential(db, user.id, context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    return json(await loadFlyvask(db, user, token, window));
  });
};
