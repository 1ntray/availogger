import { FlightLoggerClient, FlightLoggerError } from './flightlogger/client';
import { buildCalendar, inclusiveDayCount, queryWindow } from './flightlogger/calendar';
import type { AvailabilityResult } from './flightlogger/types';

export interface Env {
  FLIGHTLOGGER_API_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

const availabilityCache = new Map<string, { token: string; expiresAt: number; result: Promise<AvailabilityResult> }>();
const CACHE_MS = 60_000;

async function availabilityForRange(from: string, to: string, token: string): Promise<AvailabilityResult> {
  const key = `${from}:${to}`;
  const now = Date.now();
  const cached = availabilityCache.get(key);
  if (cached && cached.token === token && cached.expiresAt > now) return cached.result;

  const result = (async () => {
    const window = queryWindow(from, to);
    const records = await new FlightLoggerClient(token).instructorsWithAvailability(window.from, window.to);
    return buildCalendar(from, to, records);
  })();
  availabilityCache.set(key, { token, expiresAt: now + CACHE_MS, result });
  if (availabilityCache.size > 12) availabilityCache.delete(availabilityCache.keys().next().value!);
  try {
    return await result;
  } catch (error) {
    if (availabilityCache.get(key)?.result === result) availabilityCache.delete(key);
    throw error;
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(JSON.stringify(body), { status, headers });
}

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function allowedOrigin(request: Request, env: Env): { origin: string | null; permitted: boolean } {
  const origin = request.headers.get('Origin');
  if (!origin) return { origin: null, permitted: true }; // CLI/health checks; CORS is not authentication.
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return { origin, permitted: allowed.includes(origin) };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { origin, permitted } = allowedOrigin(request, env);
    if (!permitted) return json({ error: 'Origin is not allowed.' }, 403, null);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && (url.pathname === '/api/instructors' || url.pathname === '/api/availability')) {
      const headers = new Headers({
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      });
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, origin);
    if (url.pathname !== '/api/instructors' && url.pathname !== '/api/availability') return json({ error: 'Not found.' }, 404, origin);
    if (!env.FLIGHTLOGGER_API_TOKEN) return json({ error: 'The FlightLogger secret is not configured.' }, 503, origin);

    try {
      if (url.pathname === '/api/instructors') {
        if (url.search) return json({ error: 'This endpoint does not accept parameters.' }, 400, origin);
        return json({ instructors: await new FlightLoggerClient(env.FLIGHTLOGGER_API_TOKEN).instructors() }, 200, origin);
      }

      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if ([...url.searchParams.keys()].some(key => key !== 'from' && key !== 'to') || !isDate(from) || !isDate(to) ||
          url.searchParams.getAll('from').length !== 1 || url.searchParams.getAll('to').length !== 1 ||
          from > to || inclusiveDayCount(from, to) > 62) {
        return json({ error: 'Use from and to as valid YYYY-MM-DD dates, with a range of 1–62 days.' }, 400, origin);
      }
      return json(await availabilityForRange(from, to, env.FLIGHTLOGGER_API_TOKEN), 200, origin);
    } catch (error) {
      if (error instanceof FlightLoggerError) {
        const response = json({ error: error.message }, error.status, origin);
        if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
        return response;
      }
      console.error('Unexpected availability Worker error', error instanceof Error ? error.name : 'unknown');
      return json({ error: 'An unexpected availability service error occurred.' }, 500, origin);
    }
  },
};
