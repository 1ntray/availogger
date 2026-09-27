import type { AccessData, PagesEnv } from '../../../../../backend/env';
import { transportPost } from '../../../../../backend/transport/api';
import { cancelCarBooking } from '../../../../../backend/transport/cars';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => transportPost(context, [], [], (db, user) => cancelCarBooking(db, user, context.params.id));

