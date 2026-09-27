import { shiftTasksEndpoint } from '../../../../../backend/flights/api';
import type { AccessData, PagesEnv } from '../../../../../backend/env';
export const onRequest:PagesFunction<PagesEnv,'shiftId',AccessData>=context=>shiftTasksEndpoint(context);
