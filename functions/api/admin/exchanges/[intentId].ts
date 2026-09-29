import { auditEndpoint } from '../../../../backend/exchange-v2/audit';
import type { AccessData, PagesEnv } from '../../../../backend/env';
export const onRequest: PagesFunction<PagesEnv,string,AccessData> = context => auditEndpoint(context,true);
