import { handleAvailability } from '../../backend/availability';
import type { AccessData, PagesEnv } from '../../backend/env';
import { methodNotAllowed, withAuthorizedUser } from '../../backend/application-api';
import { PERMISSIONS } from '../../shared/authorization';
import { getFlightLoggerCredential } from '../../backend/flightlogger-credentials';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withAuthorizedUser(context, PERMISSIONS.availabilityView, async (db, user) => {
    const token = await getFlightLoggerCredential(db, user.id, context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    return handleAvailability(context.request, token, context.env);
  });
};
