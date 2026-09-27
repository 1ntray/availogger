import { rosterEndpoint } from '../../../backend/brakkevakt/api';
export const onRequest: PagesFunction = context => rosterEndpoint(context as never);
