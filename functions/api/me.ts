import type { AccessData, PagesEnv } from '../../backend/env';
import { json } from '../../backend/response';
import { methodNotAllowed, withApplicationUser } from '../../backend/application-api';
import { hasFlightLoggerCredential } from '../../backend/flightlogger-credentials';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'GET') return methodNotAllowed('GET');
  return withApplicationUser(context, async (db, user) => {
    const connected = await hasFlightLoggerCredential(db, user.id);
    return json({ email: user.email, subject: user.access_subject, onboardingComplete: connected,
      hasFlightLoggerCredential: connected, flightLoggerUserId: user.flightlogger_user_id });
  });
};
