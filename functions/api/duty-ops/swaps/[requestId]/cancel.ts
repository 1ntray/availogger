import { exchangeEndpoint } from '../../../../../backend/duty-ops/swap-api';
import type { AccessData, PagesEnv } from '../../../../../backend/env';
export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => exchangeEndpoint(context, 'cancel');
