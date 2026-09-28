import { MemoryRouter } from 'react-router';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyOpsPage } from '../src/pages/DutyOpsPage';
import { isDutyOpsData, loadDutyOps } from '../src/features/duty-ops/api';
import { dateLabel, dutySections, participantLabel, timeLabel } from '../src/features/duty-ops/presentation';
import type { DutyOpsData, DutyShift } from '../src/features/duty-ops/types';
import { OnboardingRequiredError } from '../src/api';

const refresh = vi.fn(async () => {});
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ refresh }) }));
const now = new Date('2026-09-27T08:00:00Z');
const shift: DutyShift = { id: 'shift', startsAt: '2026-09-27T05:00:00.000Z', endsAt: '2026-09-27T12:00:00.000Z', status: 'OPEN', participantCount: 3,
  participants: [{ userId: 'me', firstName: 'Simon', lastName: null, isCurrentUser: true }] };
const metadata = { lastSyncedAt: now.toISOString(), stale: false, from: '2026-08-27T22:00:00Z', to: '2026-11-27T23:00:00Z' };
const data: DutyOpsData = { from: '2026-08-28', to: '2026-11-27', timeZone: 'Europe/Oslo', shifts: [shift], sync: { stale: false, warning: null, discovery: metadata, assignments: metadata } };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  refresh.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Duty Ops presentation', () => {
  it('uses Oslo times and participant slots without inventing identities', () => {
    expect(timeLabel(shift)).toBe('07:00–14:00');
    expect(participantLabel(shift)).toBe('Simon · 2 others');
    expect(participantLabel({ ...shift, participants: [] })).toBe('3 students');
    expect(participantLabel({ ...shift, participants: [{ ...shift.participants[0], firstName: null }] })).toBe('Student · 2 others');
    expect(dateLabel(shift.startsAt)).toBe('Sun 27 Sept');
    expect(timeLabel({ ...shift, startsAt: '2026-09-27T21:00:00Z', endsAt: '2026-09-28T01:00:00Z' })).toBe('23:00–Mon 28 Sept 03:00');
  });
  it('groups overnight shifts, future dates, own shifts and cancellations correctly', () => {
    const overnight = { ...shift, id: 'night', startsAt: '2026-09-26T21:00:00Z', endsAt: '2026-09-27T09:00:00Z' };
    const next = { ...shift, id: 'next', startsAt: '2026-09-28T05:00:00Z', endsAt: '2026-09-28T12:00:00Z', participants: [] };
    const sections = dutySections([next, shift, overnight, { ...next, id: 'mine-next', participants: [shift.participants[0]] }, { ...next, id: 'cancel', status: 'CANCELLED' }], now.getTime());
    expect(sections.onDutyNow.map(s => s.id)).toEqual(['night', 'shift']);
    expect(sections.mine.map(s => s.id)).toEqual(['mine-next']);
    expect(sections.schedule.map(([date]) => date)).toEqual(['2026-09-28']);
    expect(dutySections([{ ...shift, endsAt: '2026-09-26T22:00:00Z', startsAt: '2026-09-26T19:00:00Z' }], now.getTime()).onDutyNow).toEqual([]);
    expect(dutySections([{ ...shift, endsAt: '2026-09-27T07:00:00Z', startsAt: '2026-09-27T05:00:00Z' }], now.getTime()).onDutyNow).toEqual([]);
    expect(dutySections([{ ...shift, participants: [] }, { ...shift, id: 'completed', participants: [], status: 'COMPLETED' }], now.getTime()).onDutyNow.map(s => s.id)).toEqual(['shift']);
  });
  it('keeps actual UTC duration and displays Oslo DST times', () => {
    expect(timeLabel({ ...shift, startsAt: '2026-03-29T00:00:00Z', endsAt: '2026-03-29T02:00:00Z' })).toBe('01:00–04:00');
  });
});

describe('same-origin Duty Ops API', () => {
  it('uses a relative authenticated no-store URL and validates normalized data', async () => {
    const fetcher = vi.fn(async () => Response.json(data)); vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await loadDutyOps(signal)).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith('/api/duty-ops', { signal, credentials: 'same-origin', cache: 'no-store' });
    expect(isDutyOpsData({ ...data, shifts: [{ ...shift, participantCount: -1 }] })).toBe(false);
    expect(isDutyOpsData({ ...data, sync: {} })).toBe(false);
  });
  it.each([401, 403])('handles Access rejection %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status })));
    await expect(loadDutyOps(new AbortController().signal)).rejects.toThrow('Reload the page');
  });
  it('distinguishes a denied portal permission from an expired Access session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'FORBIDDEN' }, { status: 403 })));
    await expect(loadDutyOps(new AbortController().signal)).rejects.toThrow('You do not have access to Duty Ops.');
  });
  it('distinguishes onboarding and safe service failure from malformed responses', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ code: 'ONBOARDING_REQUIRED' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ error: 'Try again later' }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ shifts: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadDutyOps(new AbortController().signal)).rejects.toBeInstanceOf(OnboardingRequiredError);
    await expect(loadDutyOps(new AbortController().signal)).rejects.toThrow('Try again later');
    await expect(loadDutyOps(new AbortController().signal)).rejects.toThrow('unexpected');
  });
});

describe('Duty Ops page', () => {
  it('renders compact sections and own highlights, retains stale data and reloads on demand', async () => {
    const fetcher = vi.fn(async () => Response.json({ ...data, sync: { ...data.sync, stale: true, warning: 'Refresh failed. Showing previous data.' } }));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<MemoryRouter><DutyOpsPage /></MemoryRouter>));
    expect(host.querySelector('h1')!.textContent).toBe('Duty Ops');
    expect([...host.querySelectorAll('h2')].map(h => h.textContent)).toEqual(['On duty now']);
    expect(host.textContent).toContain('Simon · 2 others'); expect(host.textContent).toContain('07:00–14:00');
    expect(host.querySelectorAll('.is-mine')).toHaveLength(1);
    expect(host.querySelector('[role=status]')!.textContent).toContain('Refresh failed');
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Retry Duty Ops"]')!.click());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('shows restrained empty states and safe failures', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...data, shifts: [] })).mockResolvedValueOnce(Response.json({ error: 'Duty Ops unavailable' }, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<MemoryRouter><DutyOpsPage /></MemoryRouter>));
    expect(host.textContent).toContain('No upcoming shifts');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('[role=alert]')!.textContent).toBe('Duty Ops unavailable');
  });
  it('refreshes current user if the backend requires onboarding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'ONBOARDING_REQUIRED' }, { status: 409 })));
    await act(async () => root.render(<MemoryRouter><DutyOpsPage /></MemoryRouter>));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
