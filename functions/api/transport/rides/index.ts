import type { AccessData, PagesEnv } from '../../../../backend/env';
import { transportGet, transportPost } from '../../../../backend/transport/api';
import { listRides, offerRide } from '../../../../backend/transport/rides';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => context.request.method === 'GET' ? transportGet(context, listRides) : transportPost(context, ['origin', 'destination', 'departureAt', 'seatCount'], ['note'], (db, user, body) => offerRide(db, user, body), 201);

