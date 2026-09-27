import { fuelEndpoint } from '../../../../backend/flights/api';
import type { AccessData, PagesEnv } from '../../../../backend/env';
export const onRequest:PagesFunction<PagesEnv,'flightId',AccessData>=context=>fuelEndpoint(context);
