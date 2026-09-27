// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import * as account from '../src/app/CurrentUser';
import type { CurrentUser } from '../src/app/current-user-api';
import type { DutyOpsData, DutyShift } from '../src/features/duty-ops/types';

const now = new Date('2026-09-27T08:00:00Z');
const student: CurrentUser = { email: 'student@example.test', subject: 'student', onboardingComplete: true,
  hasFlightLoggerCredential: true, flightLoggerUserId: 'me', roles: ['STUDENT'], permissions: ['duty_ops.view', 'transport.view'] };
const shift: DutyShift = { id: 'today', startsAt: '2026-09-27T05:00:00Z', endsAt: '2026-09-27T12:00:00Z', status: 'OPEN', participantCount: 3,
  participants: [{ userId: 'me', firstName: 'Student', lastName: 'One', isCurrentUser: true }] };
const next = { ...shift, id: 'next', startsAt: '2026-09-28T05:00:00Z', endsAt: '2026-09-28T12:00:00Z' };
function response(shifts: DutyShift[], stale = false) {
  const metadata = { lastSyncedAt: now.toISOString(), stale, from: '2026-08-27T22:00:00Z', to: '2026-11-27T23:00:00Z' };
  const data: DutyOpsData = { from: '2026-08-28', to: '2026-11-27', timeZone: 'Europe/Oslo', shifts,
    sync: { stale, warning: stale ? 'Previous schedule' : null, discovery: metadata, assignments: metadata } };
  return Response.json(data);
}
let user: CurrentUser;
let host: HTMLDivElement;
let root: Root;
const refresh = vi.fn(async () => {});
async function render() { await act(async () => root.render(<MemoryRouter><HomePage /></MemoryRouter>)); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(now);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  user = { ...student }; refresh.mockClear();
  vi.spyOn(account, 'useCurrentUser').mockImplementation(() => ({ user, loading: false, error: '', retry: vi.fn(), refresh }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Home Duty Ops integration', () => {
  it('shows today in Oslo order, including overnight shifts, with shared participants and statuses', async () => {
    const overnight = { ...shift, id: 'overnight', startsAt: '2026-09-26T21:00:00Z', endsAt: '2026-09-27T09:00:00Z' };
    const cancelled = { ...shift, id: 'cancelled', startsAt: '2026-09-27T13:00:00Z', endsAt: '2026-09-27T14:00:00Z', status: 'CANCELLED' as const };
    const fetcher = vi.fn(async () => response([next, cancelled, shift, overnight])); vi.stubGlobal('fetch', fetcher);
    await render();
    const times = [...host.querySelectorAll('.today-overview .duty-row time')].map(t => t.textContent);
    expect(times).toEqual(['23:00–Sun 27 Sept 11:00', '07:00–14:00', '15:00–16:00']);
    expect(host.textContent).toContain('Student One · 2 others');
    expect(host.textContent).toContain('Cancelled');
    expect(host.textContent).toContain('Europe/Oslo');
    expect(host.textContent).not.toContain('Your next Duty Ops');
    expect(host.textContent).not.toContain('Nothing scheduled');
    expect(fetcher).toHaveBeenCalledWith('/api/duty-ops', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    expect(host.querySelector('.module-link[href="/duty-ops"]')!.textContent).not.toContain('Coming soon');
    expect(host.querySelector('.module-link[href="/transport"]')!.textContent).toContain('Coming soon');
  });
  it('falls back to only the earliest upcoming personal non-cancelled shift', async () => {
    const cancelled = { ...next, id: 'cancelled', startsAt: '2026-09-28T01:00:00Z', status: 'CANCELLED' as const };
    const other = { ...next, id: 'other', startsAt: '2026-09-28T02:00:00Z', participants: [{ ...next.participants[0], isCurrentUser: false }] };
    const later = { ...next, id: 'later', startsAt: '2026-10-02T05:00:00Z', endsAt: '2026-10-02T12:00:00Z' };
    vi.stubGlobal('fetch', vi.fn(async () => response([later, cancelled, other, next])));
    await render();
    expect(host.textContent).toContain('Nothing scheduled');
    expect(host.textContent).toContain('Your next Duty Ops');
    expect(host.textContent).toContain('Mon 28 Sept');
    expect(host.querySelectorAll('.duty-row')).toHaveLength(1);
    expect(host.querySelector('.duty-row.is-mine')).not.toBeNull();
    expect(host.querySelector('h3 a')!.getAttribute('href')).toBe('/duty-ops');
  });
  it('keeps an empty day small when no personal upcoming shift exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ ...next, participants: [] }])));
    await render();
    expect(host.querySelector('.today-overview')!.textContent).toBe('TodayNothing scheduled');
    expect(host.querySelector('.duty-row')).toBeNull();
    expect(host.querySelector('.quick-access')).not.toBeNull();
  });
  it('does not request or expose Duty Ops without permission, including after revocation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response([shift])); vi.stubGlobal('fetch', fetcher);
    user = { ...student, permissions: ['transport.view'] };
    await render();
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.querySelector('a[href="/duty-ops"]')).toBeNull();
    expect(host.querySelector('.today-overview')).toBeNull();
    user = student; await render();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Student One');
    const signal = fetcher.mock.calls[0][1]!.signal as AbortSignal;
    user = { ...student, permissions: [] }; await render();
    expect(signal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Student One');
  });
  it('leaves navigation usable while loading and on error, without claiming an empty schedule', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    await render();
    expect(host.querySelector('[role=status]')!.textContent).toBe('Loading Duty Ops…');
    expect(host.querySelector('.module-link[href="/duty-ops"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Nothing scheduled');
    await act(async () => resolve(Response.json({ error: 'Unavailable' }, { status: 503 })));
    expect(host.querySelector('[role=alert]')!.textContent).toContain('Duty Ops unavailable');
    expect(host.querySelector('[role=alert] a')!.getAttribute('href')).toBe('/duty-ops');
    expect(host.querySelector('.module-link[href="/transport"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Nothing scheduled');
  });
  it('marks stale data while still displaying the returned schedule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([shift], true)));
    await render();
    expect(host.textContent).toContain('07:00–14:00');
    expect(host.querySelector('[role=status]')!.textContent).toContain('Schedule may be out of date');
  });
  it('aborts an old identity request and ignores its late result', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })).mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetcher); await render();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    user = { ...student, subject: 'different-student', flightLoggerUserId: 'different' }; await render();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(response([shift])));
    expect(host.textContent).toContain('Nothing scheduled');
    expect(host.textContent).not.toContain('Student One');
  });
  it('refreshes the account on the existing onboarding-required response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'ONBOARDING_REQUIRED' }, { status: 409 })));
    await render();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  });
  it('advances the date and reloads once at Oslo midnight, without polling the API each minute', async () => {
    vi.setSystemTime(new Date('2026-09-27T21:59:00Z'));
    const fetcher = vi.fn().mockResolvedValueOnce(response([shift, next])).mockResolvedValueOnce(response([next]));
    vi.stubGlobal('fetch', fetcher); await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.querySelector('.today-date')!.getAttribute('datetime')).toBe('2026-09-28');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain('Your next Duty Ops');
    expect(host.querySelector('.duty-row time')!.getAttribute('datetime')).toBe(next.startsAt);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
