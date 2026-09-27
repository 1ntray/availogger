import { exchangeEndpoint } from '../../../../../../backend/flyvask/swap-api';
import type { AccessData, PagesEnv } from '../../../../../../backend/env';
export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => exchangeEndpoint(context, 'propose');
