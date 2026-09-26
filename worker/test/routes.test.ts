import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const values = new Map<string, string>();
const cache = {
  get: vi.fn(async (key: string) => values.has(key) ? JSON.parse(values.get(key)!) : null),
  put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
};
const env = { FLIGHTLOGGER_API_TOKEN: 'test-token', ALLOWED_ORIGINS: 'http://localhost:5173', AVAILABILITY_CACHE: cache as unknown as KVNamespace };

describe('Worker route boundaries', () => {
  it('accepts only configured browser origins', async () => {
    const response = await worker.fetch(new Request('https://worker.example/api/availability', { headers: { Origin: 'https://other.example' } }), env);
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('handles preflight without a response body', async () => {
    const response = await worker.fetch(new Request('https://worker.example/api/availability', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('rejects invalid ranges and arbitrary GraphQL posts', async () => {
    const range = await worker.fetch(new Request('https://worker.example/api/availability?from=2026-02-30&to=2026-03-01'), env);
    const post = await worker.fetch(new Request('https://worker.example/api/availability', { method: 'POST', body: '{"query":"mutation"}' }), env);
    expect(range.status).toBe(400);
    expect(post.status).toBe(405);
  });

  it('does not expose the unused instructors route', async () => {
    const get = await worker.fetch(new Request('https://worker.example/api/instructors'), env);
    const preflight = await worker.fetch(new Request('https://worker.example/api/instructors', { method: 'OPTIONS' }), env);
    expect(get.status).toBe(404);
    expect(preflight.status).toBe(404);
  });

  it('reuses a successful calendar response for the same range', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { users: {
      nodes: [{ id: '1', firstName: 'Ada', lastName: 'L', callSign: '', availabilities: {
        nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
      } }], pageInfo: { hasNextPage: false, endCursor: null },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const url = 'https://worker.example/api/availability?from=2031-01-01&to=2031-01-02';
      const first = await worker.fetch(new Request(url), env);
      const second = await worker.fetch(new Request(url), env);
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
      const url = 'https://worker.example/api/availability?from=2031-01-03&to=2031-01-04';
      const response = await worker.fetch(new Request(url), env);
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('45');
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('rate limiting') });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the persisted daily cache after a Worker restart', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { users: {
      nodes: [{ id: '1', firstName: 'Ada', lastName: 'L', callSign: '', availabilities: {
        nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
      } }], pageInfo: { hasNextPage: false, endCursor: null },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const url = 'https://worker.example/api/availability?from=2031-02-01&to=2031-02-02';
      vi.resetModules();
      const firstWorker = (await import('../src/index')).default;
      const first = await firstWorker.fetch(new Request(url), env);
      vi.resetModules();
      const restartedWorker = (await import('../src/index')).default;
      const second = await restartedWorker.fetch(new Request(url), env);
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
      const url = 'https://worker.example/api/availability?from=2031-03-01&to=2031-03-02';
      const first = await worker.fetch(new Request(url), env);
      expect((await first.json() as { cachedAt: string }).cachedAt).toBe('2030-01-01T12:00:00.000Z');
      clock.mockReturnValue(start + 86_400_000);
      const second = await worker.fetch(new Request(url), env);
      expect((await second.json() as { cachedAt: string }).cachedAt).toBe('2030-01-02T12:00:00.000Z');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
