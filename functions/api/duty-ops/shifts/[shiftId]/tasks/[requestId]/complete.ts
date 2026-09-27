import { completeFuelEndpoint } from '../../../../../../../backend/flights/api';
import type { AccessData, PagesEnv } from '../../../../../../../backend/env';
export const onRequest:PagesFunction<PagesEnv,'shiftId'|'requestId',AccessData>=context=>completeFuelEndpoint(context);
