import { CURRENT_USER_QUERY, INSTRUCTORS_QUERY, INSTRUCTORS_WITH_AVAILABILITY_QUERY, MORE_AVAILABILITY_QUERY } from './queries';
import type { AvailabilityPeriod, Instructor } from './types';

const ENDPOINT = 'https://api.flightlogger.net/graphql';
const PAGE_SIZE = 25;
const MAX_REQUESTS = 45; // Workers Free permits 50 external subrequests per invocation.
const MAX_INSTRUCTORS = 500;
const rateLimits = new Map<string, number>(); // Hashed token keys, never plaintext credentials.

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type Connection<T> = { nodes: T[]; pageInfo: PageInfo };
type RawInstructor = Instructor & { availabilities: Connection<AvailabilityPeriod> };

export class FlightLoggerError extends Error {
  constructor(message: string, public readonly status = 502, public readonly retryAfterSeconds?: number, public readonly authenticationFailed = false) { super(message); }
}

function retryAfterSeconds(value: string | null): number {
  const seconds = value === null ? NaN : Number(value);
  const delay = Number.isFinite(seconds) ? seconds : value === null ? NaN : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(delay) && delay > 0 ? Math.min(3600, Math.max(1, Math.ceil(delay))) : 60;
}

function rateLimitError(seconds: number): FlightLoggerError {
  return new FlightLoggerError(`FlightLogger is rate limiting requests. Please wait about ${seconds} seconds before retrying.`, 429, seconds);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function connection<T>(value: unknown, parseNode: (value: unknown) => T): Connection<T> {
  if (!isObject(value) || !Array.isArray(value.nodes) || !isObject(value.pageInfo) ||
      typeof value.pageInfo.hasNextPage !== 'boolean' ||
      (value.pageInfo.endCursor !== null && typeof value.pageInfo.endCursor !== 'string')) {
    throw new FlightLoggerError('FlightLogger returned an unexpected pagination response.');
  }
  return { nodes: value.nodes.map(parseNode), pageInfo: {
    hasNextPage: value.pageInfo.hasNextPage,
    endCursor: value.pageInfo.endCursor as string | null,
  } };
}

function parseInstructor(value: unknown): Instructor {
  if (!isObject(value) || typeof value.id !== 'string' ||
      value.id.length === 0 || (value.firstName !== null && typeof value.firstName !== 'string') ||
      (value.lastName !== null && typeof value.lastName !== 'string') ||
      typeof value.callSign !== 'string') {
    throw new FlightLoggerError('FlightLogger returned an unexpected instructor record.');
  }
  return { id: value.id, firstName: value.firstName || '', lastName: value.lastName || '', callSign: value.callSign };
}

function parsePeriod(value: unknown): AvailabilityPeriod {
  if (!isObject(value) || typeof value.startsAt !== 'string' || typeof value.endsAt !== 'string' ||
      typeof value.unavailable !== 'boolean' || !Number.isFinite(Date.parse(value.startsAt)) ||
      !Number.isFinite(Date.parse(value.endsAt)) || Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    throw new FlightLoggerError('FlightLogger returned an invalid availability period.');
  }
  return { startsAt: value.startsAt, endsAt: value.endsAt, unavailable: value.unavailable };
}

function nextCursor(info: PageInfo, previous: string | null): string | null {
  if (!info.hasNextPage) return null;
  if (!info.endCursor || info.endCursor === previous) {
    throw new FlightLoggerError('FlightLogger pagination stopped making progress.');
  }
  return info.endCursor;
}

export class FlightLoggerClient {
  private requestCount = 0;
  private tokenHash?: Promise<string>;
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

  private async query(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.tokenHash ||= crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.token))
      .then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
    const hash = await this.tokenHash;
    const rateLimitedUntil = rateLimits.get(hash) || 0;
    if (Date.now() < rateLimitedUntil) throw rateLimitError(Math.ceil((rateLimitedUntil - Date.now()) / 1000));
    rateLimits.delete(hash);
    if (++this.requestCount > MAX_REQUESTS) throw new FlightLoggerError('Too many FlightLogger pages were needed for this request.');
    let response: Response;
    try {
      response = await this.fetcher(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      console.error('FlightLogger fetch failed');
      throw new FlightLoggerError('Could not connect to FlightLogger. Try again shortly.', 503);
    }
    if (response.status === 401 || response.status === 403) throw new FlightLoggerError('Your FlightLogger connection could not be authenticated. Replace the API key in Settings.', 502, undefined, true);
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get('Retry-After'));
      rateLimits.set(hash, Math.max(rateLimits.get(hash) || 0, Date.now() + seconds * 1000));
      if (rateLimits.size > 128) rateLimits.delete(rateLimits.keys().next().value!);
      throw rateLimitError(seconds);
    }
    if (!response.ok) throw new FlightLoggerError(`FlightLogger returned HTTP ${response.status}.`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new FlightLoggerError('FlightLogger returned invalid JSON.'); }
    if (!isObject(body)) throw new FlightLoggerError('FlightLogger returned an invalid response.');
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      console.error('FlightLogger rejected a query');
      throw new FlightLoggerError('FlightLogger rejected the request.');
    }
    if (!isObject(body.data)) throw new FlightLoggerError('FlightLogger returned no data.');
    return body.data;
  }

  async currentUser(): Promise<{ id: string }> {
    const data = await this.query(CURRENT_USER_QUERY, {});
    if (!isObject(data.user) || typeof data.user.id !== 'string' || !data.user.id || data.user.id.length > 256) {
      throw new FlightLoggerError('The FlightLogger API key could not be verified.', 422);
    }
    return { id: data.user.id };
  }

  async instructors(): Promise<Instructor[]> {
    const all: Instructor[] = [];
    let after: string | null = null;
    do {
      const data = await this.query(INSTRUCTORS_QUERY, { first: PAGE_SIZE, after });
      const page = connection(data.users, parseInstructor);
      all.push(...page.nodes);
      if (all.length > MAX_INSTRUCTORS) throw new FlightLoggerError('The instructor list exceeds the supported size.');
      after = nextCursor(page.pageInfo, after);
    } while (after);
    return all;
  }

  async instructorsWithAvailability(from: string, to: string): Promise<{ instructor: Instructor; periods: AvailabilityPeriod[] }[]> {
    const all: { instructor: Instructor; periods: AvailabilityPeriod[] }[] = [];
    const more: { index: number; id: string; after: string }[] = [];
    let after: string | null = null;
    do {
      const data = await this.query(INSTRUCTORS_WITH_AVAILABILITY_QUERY, { first: PAGE_SIZE, after, from, to });
      const page = connection<RawInstructor>(data.users, value => {
        const instructor = parseInstructor(value);
        const availabilities = connection((value as Record<string, unknown>).availabilities, parsePeriod);
        return { ...instructor, availabilities };
      });
      for (const node of page.nodes) {
        const index = all.length;
        all.push({ instructor: parseInstructor(node), periods: node.availabilities.nodes });
        const cursor = nextCursor(node.availabilities.pageInfo, null);
        if (cursor) more.push({ index, id: node.id, after: cursor });
      }
      if (all.length > MAX_INSTRUCTORS) throw new FlightLoggerError('The instructor list exceeds the supported size.');
      after = nextCursor(page.pageInfo, after);
    } while (after);

    // Small batches bound simultaneous FlightLogger requests and avoid a single
    // crowded instructor failing the entire invocation by consuming the free quota.
    while (more.length) {
      const batch = more.splice(0, 4);
      const pages = await Promise.all(batch.map(async item => {
        const data = await this.query(MORE_AVAILABILITY_QUERY, { id: item.id, from, to, after: item.after });
        if (!isObject(data.user)) throw new FlightLoggerError('An instructor disappeared while loading availability.');
        return connection(data.user.availabilities, parsePeriod);
      }));
      pages.forEach((page, index) => {
        const item = batch[index];
        all[item.index].periods.push(...page.nodes);
        const cursor = nextCursor(page.pageInfo, item.after);
        if (cursor) more.push({ ...item, after: cursor });
      });
    }
    return all;
  }
}
