import { handleAvailability } from '../../backend/availability';
import type { AccessData, PagesEnv } from '../../backend/env';
import { methodNotAllowed, withApplicationUser } from '../../backend/application-api';
import { getFlightLoggerCredential } from '../../backend/flightlogger-credentials';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withApplicationUser(context, async (db, user) => {
    const token = await getFlightLoggerCredential(db, user.id, context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    return handleAvailability(context.request, token, context.env);
  });
};
