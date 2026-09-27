import type { AccessData, PagesEnv } from '../../../../backend/env';
import { creditEndpoint } from '../../../../backend/duty-ops/credit-api';
export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => creditEndpoint(context, true);
