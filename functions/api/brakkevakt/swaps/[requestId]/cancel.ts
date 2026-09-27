import { swapEndpoint } from '../../../../../backend/brakkevakt/api';
export const onRequest: PagesFunction = context => swapEndpoint(context as never, 'cancel');
