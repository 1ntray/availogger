import type { AccessData, PagesEnv } from '../../../../../backend/env';
import { transportPost } from '../../../../../backend/transport/api';
import { reportCarLocation } from '../../../../../backend/transport/cars';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => transportPost(context, ['location'], [], (db, user, body) => reportCarLocation(db, user, context.params.id, body));

