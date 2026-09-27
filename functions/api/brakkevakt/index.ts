import { scheduleEndpoint } from '../../../backend/brakkevakt/api';
export const onRequest: PagesFunction = context => scheduleEndpoint(context as never);
