import { FlightLoggerClient, FlightLoggerError } from '../worker/src/flightlogger/client';
import { buildCalendar, inclusiveDayCount, queryWindow } from '../worker/src/flightlogger/calendar';
import type { AvailabilityResult } from '../worker/src/flightlogger/types';
import { json } from './response';

export interface AvailabilityEnv {
  FLIGHTLOGGER_API_TOKEN: string;
  AVAILABILITY_CACHE: KVNamespace;
}

// Preserve the one-day policy during migration. Access can support a shorter TTL later.
// Reload view reads the cache; it does not bypass it.
const AVAILABILITY_CACHE_TTL_SECONDS = 86_400;
const AVAILABILITY_CACHE_TTL_MS = AVAILABILITY_CACHE_TTL_SECONDS * 1000;
const HOT_CACHE_TTL_MS = 60_000;
const CACHE_VERSION = 1;
type CacheEntry = { version: number; cachedAt: number; result: AvailabilityResult };
const hotCache = new Map<string, { expiresAt: number; entry: CacheEntry }>();
const inFlight = new Map<string, Promise<CacheEntry>>();

async function availabilityForRange(from: string, to: string, env: AvailabilityEnv): Promise<CacheEntry> {
  // Hash the token so future account-specific tokens naturally separate cached data.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.FLIGHTLOGGER_API_TOKEN));
  const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `availability:v${CACHE_VERSION}:${tokenHash}:${from}:${to}`;
  const now = Date.now();
  const hot = hotCache.get(key);
  if (hot && hot.expiresAt > now) return hot.entry;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<CacheEntry> => {
    const stored = await env.AVAILABILITY_CACHE.get<CacheEntry>(key, 'json');
    if (stored?.version === CACHE_VERSION && Number.isFinite(stored.cachedAt) &&
        stored.cachedAt <= Date.now() && Date.now() - stored.cachedAt < AVAILABILITY_CACHE_TTL_MS &&
        stored.result?.from === from && stored.result?.to === to &&
        stored.result?.timeZone === 'Europe/Oslo' && Array.isArray(stored.result?.instructors)) {
      return stored;
    }
    const window = queryWindow(from, to);
    const records = await new FlightLoggerClient(env.FLIGHTLOGGER_API_TOKEN).instructorsWithAvailability(window.from, window.to);
    const entry: CacheEntry = { version: CACHE_VERSION, cachedAt: Date.now(), result: buildCalendar(from, to, records) };
    await env.AVAILABILITY_CACHE.put(key, JSON.stringify(entry), { expirationTtl: AVAILABILITY_CACHE_TTL_SECONDS });
    return entry;
  })();
  inFlight.set(key, task);
  try {
    const entry = await task;
    hotCache.set(key, { expiresAt: Math.min(entry.cachedAt + AVAILABILITY_CACHE_TTL_MS, Date.now() + HOT_CACHE_TTL_MS), entry });
    if (hotCache.size > 12) hotCache.delete(hotCache.keys().next().value!);
    return entry;
  } finally {
    inFlight.delete(key);
  }
}

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Authentication is applied by Pages /api middleware before this handler touches KV.
// The old Worker uses this only during the documented migration/rollback window.
export async function handleAvailability(request: Request, env: AvailabilityEnv): Promise<Response> {
  if (request.method !== 'GET') {
    const response = json({ error: 'Method not allowed.' }, 405);
    response.headers.set('Allow', 'GET');
    return response;
  }
  if (!env.FLIGHTLOGGER_API_TOKEN || !env.AVAILABILITY_CACHE) return json({ error: 'The availability service is not configured.' }, 503);
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ([...url.searchParams.keys()].some(key => key !== 'from' && key !== 'to') || !isDate(from) || !isDate(to) ||
      url.searchParams.getAll('from').length !== 1 || url.searchParams.getAll('to').length !== 1 ||
      from > to || inclusiveDayCount(from, to) > 62) {
    return json({ error: 'Use from and to as valid YYYY-MM-DD dates, with a range of 1–62 days.' }, 400);
  }
  try {
    const entry = await availabilityForRange(from, to, env);
    return json({ ...entry.result, cachedAt: new Date(entry.cachedAt).toISOString() });
  } catch (error) {
    if (error instanceof FlightLoggerError) {
      const response = json({ error: error.message }, error.status);
      if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
      return response;
    }
    console.error('Unexpected availability error', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'An unexpected availability service error occurred.' }, 500);
  }
}
