import { contactReplyEndpoint } from '../../../../../backend/contact';
import type { AccessData, PagesEnv } from '../../../../../backend/env';
export const onRequest:PagesFunction<PagesEnv,string,AccessData>=context=>contactReplyEndpoint(context,true);
