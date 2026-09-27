import type { AccessData, PagesEnv } from '../../backend/env';
import { json } from '../../backend/response';
import { methodNotAllowed, withApplicationUser } from '../../backend/application-api';
import { hasFlightLoggerCredential } from '../../backend/flightlogger-credentials';
import { getEffectivePermissions, getUserRoles } from '../../backend/authorization';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withApplicationUser(context, async (db, user) => {
    const connected = await hasFlightLoggerCredential(db, user.id);
    const [permissions, roles] = await Promise.all([getEffectivePermissions(db, user), getUserRoles(db, user)]);
    return json({ email: user.email, subject: user.access_subject, firstName: user.flightlogger_first_name, lastName: user.flightlogger_last_name, onboardingComplete: connected,
      hasFlightLoggerCredential: connected, flightLoggerUserId: user.flightlogger_user_id, permissions, roles });
  });
};
