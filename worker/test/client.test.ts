import { describe, expect, it, vi } from 'vitest';
import { FlightLoggerClient } from '../src/flightlogger/client';

function result(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('FlightLogger pagination', () => {
  it('keeps the Workers global fetch binding intact', async () => {
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(result({ users: {
        nodes: [{ id: '1', firstName: 'Ada', lastName: 'L', callSign: '' }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } }));
    });
    try {
      const client = new FlightLoggerClient('test-token');
      expect((await client.instructors()).map(user => user.id)).toEqual(['1']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('collects instructor pages and extra availability pages', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string | null> };
      expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
      if (query.includes('MoreAvailability')) {
        expect(variables.after).toBe('availability-next');
        return result({ user: { availabilities: { nodes: [{ startsAt: '2026-09-27T08:00:00Z', endsAt: '2026-09-27T09:00:00Z', unavailable: true }], pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      const firstPage = variables.after === null;
      return result({ users: {
        nodes: [{ id: firstPage ? '1' : '2', firstName: firstPage ? 'Ada' : 'Grace', lastName: 'L', callSign: '',
          availabilities: { nodes: firstPage ? [{ startsAt: '2026-09-26T08:00:00Z', endsAt: '2026-09-26T09:00:00Z', unavailable: false }] : [],
            pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'availability-next' : null } } }],
        pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'users-next' : null },
      } });
    });
    const client = new FlightLoggerClient('test-token', fetcher as unknown as typeof fetch);
    const rows = await client.instructorsWithAvailability('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z');
    expect(rows.map(row => row.instructor.id)).toEqual(['1', '2']);
    expect(rows[0].periods.map(period => period.unavailable)).toEqual([false, true]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects a repeated cursor instead of returning partial data', async () => {
    const fetcher = vi.fn(async () => result({ users: {
      nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' },
    } }));
    const client = new FlightLoggerClient('test-token', fetcher as unknown as typeof fetch);
    await expect(client.instructors()).rejects.toThrow('pagination stopped making progress');
  });

  it('returns a clear rate limit with Retry-After and pauses subsequent upstream calls', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } }));
    const client = new FlightLoggerClient('test-token', fetcher as unknown as typeof fetch);
    await expect(client.instructors()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 });
    await expect(client.instructors()).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
