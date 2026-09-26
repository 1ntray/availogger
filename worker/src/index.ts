// Legacy standalone Worker: retained only for migration rollback.
// Pages Functions use backend/availability directly and have no CORS layer.
import { handleAvailability, type AvailabilityEnv } from '../../backend/availability';
import { json } from '../../backend/response';

export interface Env extends AvailabilityEnv { ALLOWED_ORIGINS: string }

function withOrigin(response: Response, origin: string | null): Response {
  response.headers.set('Vary', 'Origin');
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return withOrigin(json({ error: 'Origin is not allowed.' }, 403), null);
    if (new URL(request.url).pathname !== '/api/availability') return withOrigin(json({ error: 'Not found.' }, 404), origin);
    if (request.method === 'OPTIONS') {
      return withOrigin(new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' },
      }), origin);
    }
    return withOrigin(await handleAvailability(request, env), origin);
  },
};
