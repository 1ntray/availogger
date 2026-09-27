import type { AccessData, PagesEnv } from '../../../../backend/env';
import { transportGet } from '../../../../backend/transport/api';
import { listCars } from '../../../../backend/transport/cars';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => transportGet(context, listCars);

