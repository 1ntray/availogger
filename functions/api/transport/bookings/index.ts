import type { AccessData, PagesEnv } from '../../../../backend/env';
import { transportPost } from '../../../../backend/transport/api';
import { bookCar } from '../../../../backend/transport/cars';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => transportPost(context, ['vehicleId', 'origin', 'destination', 'startsAt'], [], (db, user, body) => bookCar(db, user, body), 201);

