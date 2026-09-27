import { weekEndpoint } from '../../../../backend/brakkevakt/api';
export const onRequest: PagesFunction = context => weekEndpoint(context as never);
