import type { AccessData, PagesEnv } from '../../../../../backend/env';
import { transportPost } from '../../../../../backend/transport/api';
import { confirmCarBooking } from '../../../../../backend/transport/cars';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => transportPost(context, ['asPlanned'], ['location'], (db, user, body) => confirmCarBooking(db, user, context.params.id, body));

