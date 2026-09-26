import { handleAvailability } from '../../backend/availability';
import type { PagesEnv } from '../../backend/env';

export const onRequest: PagesFunction<PagesEnv> = context => handleAvailability(context.request, context.env);
