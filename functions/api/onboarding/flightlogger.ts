import { methodNotAllowed, withApplicationUser } from '../../../backend/application-api';
import { readCredentialRequest } from '../../../backend/credential-request';
import type { AccessData, PagesEnv } from '../../../backend/env';
import { storeFlightLoggerCredential } from '../../../backend/flightlogger-credentials';
import { json } from '../../../backend/response';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => {
  if (context.request.method !== 'POST') return methodNotAllowed('POST');
  return withApplicationUser(context, async (db, user) => {
    const apiKey = await readCredentialRequest(context.request);
    return json(await storeFlightLoggerCredential(db, user, apiKey, context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY));
  });
};
