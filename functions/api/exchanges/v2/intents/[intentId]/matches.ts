import { exchangeV2Endpoint } from '../../../../../../backend/exchange-v2/api';
import type { AccessData, PagesEnv } from '../../../../../../backend/env';
export const onRequest: PagesFunction<PagesEnv,string,AccessData> = context => exchangeV2Endpoint(context,'matches');
