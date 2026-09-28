import { inboxEndpoint } from '../../../backend/inbox';
import type { AccessData, PagesEnv } from '../../../backend/env';

export const onRequest:PagesFunction<PagesEnv,string,AccessData>=context=>inboxEndpoint(context);
