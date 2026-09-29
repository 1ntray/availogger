import { contactStatusEndpoint } from '../../../../../backend/contact';
import type { AccessData, PagesEnv } from '../../../../../backend/env';
export const onRequest:PagesFunction<PagesEnv,string,AccessData>=context=>contactStatusEndpoint(context);
