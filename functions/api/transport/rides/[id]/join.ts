import type { AccessData, PagesEnv } from '../../../../../backend/env';
import { transportPost } from '../../../../../backend/transport/api';
import { joinRide } from '../../../../../backend/transport/rides';

export const onRequest: PagesFunction<PagesEnv, string, AccessData> = context => transportPost(context, [], [], (db, user) => joinRide(db, user, context.params.id));

