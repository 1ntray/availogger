import { json } from '../../backend/response';

// Unknown API paths must return JSON, not Pages' SPA index.html fallback.
export const onRequest: PagesFunction = () => json({ error: 'Not found.' }, 404);
