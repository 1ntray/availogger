import { describe, expect, it, vi } from 'vitest';
import { handleAvailability } from '../backend/availability';

const values = new Map<string, string>();
const cache = {
  get: vi.fn(async (key: string) => values.has(key) ? JSON.parse(values.get(key)!) : null),
  put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
};
const env = { FLIGHTLOGGER_API_TOKEN: 'test-token', AVAILABILITY_CACHE: cache as unknown as KVNamespace };

describe('Availability service boundaries and daily cache', () => {
  it('rejects invalid ranges and arbitrary GraphQL posts', async () => {
    const range = await handleAvailability(new Request('https://student.example/api/availability?from=2026-02-30&to=2026-03-01'), env);
    const post = await handleAvailability(new Request('https://student.example/api/availability', { method: 'POST', body: '{"query":"mutation"}' }), env);
    expect(range.status).toBe(400);
    expect(post.status).toBe(405);
  });

  it('reuses a successful calendar response for the same range', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { users: {
      nodes: [{ id: '1', firstName: 'Ada', lastName: 'L', callSign: '', availabilities: {
        nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
      } }], pageInfo: { hasNextPage: false, endCursor: null },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const url = 'https://student.example/api/availability?from=2031-01-01&to=2031-01-02';
      const first = await handleAvailability(new Request(url), env);
      const second = await handleAvailability(new Request(url), env);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = await first.json() as { cachedAt: string; instructors: unknown[] };
      const secondBody = await second.json() as { cachedAt: string };
      expect(firstBody.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Number.isFinite(Date.parse(firstBody.cachedAt))).toBe(true);
      expect(secondBody.cachedAt).toBe(firstBody.cachedAt);
      expect(firstBody.instructors).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), { expirationTtl: 86400 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes FlightLogger rate limits and retry delay to the browser', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '45' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const url = 'https://student.example/api/availability?from=2031-01-03&to=2031-01-04';
      const response = await handleAvailability(new Request(url), env);
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('45');
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('rate limiting') });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the persisted daily cache after an isolate restart', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { users: {
      nodes: [{ id: '1', firstName: 'Ada', lastName: 'L', callSign: '', availabilities: {
        nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
      } }], pageInfo: { hasNextPage: false, endCursor: null },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const url = 'https://student.example/api/availability?from=2031-02-01&to=2031-02-02';
      vi.resetModules();
      const firstHandler = (await import('../backend/availability')).handleAvailability;
      const first = await firstHandler(new Request(url), env);
      vi.resetModules();
      const restartedHandler = (await import('../backend/availability')).handleAvailability;
      const second = await restartedHandler(new Request(url), env);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetches a new timestamp after the daily cache expires', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { users: {
      nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
    } } }), { status: 200 }));
    const clock = vi.spyOn(Date, 'now');
    vi.stubGlobal('fetch', fetcher);
    try {
      const start = Date.parse('2030-01-01T12:00:00.000Z');
      clock.mockReturnValue(start);
      const url = 'https://student.example/api/availability?from=2031-03-01&to=2031-03-02';
      const first = await handleAvailability(new Request(url), env);
      expect((await first.json() as { cachedAt: string }).cachedAt).toBe('2030-01-01T12:00:00.000Z');
      clock.mockReturnValue(start + 86_400_000);
      const second = await handleAvailability(new Request(url), env);
      expect((await second.json() as { cachedAt: string }).cachedAt).toBe('2030-01-02T12:00:00.000Z');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
