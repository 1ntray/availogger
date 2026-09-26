import { FlightLoggerClient, FlightLoggerError } from './flightlogger/client';
import { buildCalendar, inclusiveDayCount, queryWindow } from './flightlogger/calendar';
import type { AvailabilityResult } from './flightlogger/types';

export interface Env {
  FLIGHTLOGGER_API_TOKEN: string;
  ALLOWED_ORIGINS: string;
  AVAILABILITY_CACHE: KVNamespace;
}

const DAY_SECONDS = 86_400;
const DAY_MS = DAY_SECONDS * 1000;
const HOT_CACHE_MS = 60_000;
const CACHE_VERSION = 1;
type CacheEntry = { version: number; cachedAt: number; result: AvailabilityResult };
const hotCache = new Map<string, { expiresAt: number; result: AvailabilityResult }>();
const inFlight = new Map<string, Promise<CacheEntry>>();

async function availabilityForRange(from: string, to: string, env: Env): Promise<AvailabilityResult> {
  // A token change must not reuse data fetched for a different FlightLogger account.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.FLIGHTLOGGER_API_TOKEN));
  const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `availability:v${CACHE_VERSION}:${tokenHash}:${from}:${to}`;
  const now = Date.now();
  const hot = hotCache.get(key);
  if (hot && hot.expiresAt > now) return hot.result;
  const pending = inFlight.get(key);
  if (pending) return (await pending).result;

  const task = (async (): Promise<CacheEntry> => {
    const stored = await env.AVAILABILITY_CACHE.get<CacheEntry>(key, 'json');
    if (stored?.version === CACHE_VERSION && typeof stored.cachedAt === 'number' &&
        stored.cachedAt <= Date.now() && Date.now() - stored.cachedAt < DAY_MS &&
        stored.result?.from === from && stored.result?.to === to &&
        stored.result?.timeZone === 'Europe/Oslo' && Array.isArray(stored.result?.instructors)) {
      return stored;
    }
    const window = queryWindow(from, to);
    const records = await new FlightLoggerClient(env.FLIGHTLOGGER_API_TOKEN).instructorsWithAvailability(window.from, window.to);
    const entry: CacheEntry = { version: CACHE_VERSION, cachedAt: Date.now(), result: buildCalendar(from, to, records) };
    await env.AVAILABILITY_CACHE.put(key, JSON.stringify(entry), { expirationTtl: DAY_SECONDS });
    return entry;
  })();
  inFlight.set(key, task);
  try {
    const entry = await task;
    hotCache.set(key, { expiresAt: Math.min(entry.cachedAt + DAY_MS, Date.now() + HOT_CACHE_MS), result: entry.result });
    if (hotCache.size > 12) hotCache.delete(hotCache.keys().next().value!);
    return entry.result;
  } finally {
    inFlight.delete(key);
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
      return json(await availabilityForRange(from, to, env), 200, origin);
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
