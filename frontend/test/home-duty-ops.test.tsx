// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import * as account from '../src/app/CurrentUser';
import type { CurrentUser } from '../src/app/current-user-api';

const now = '2026-09-27T08:00:00Z';
const student: CurrentUser = { email: 'student@example.test', subject: 'student', onboardingComplete: true,
  hasFlightLoggerCredential: true, flightLoggerUserId: 'me', roles: ['STUDENT'], permissions: ['flights.view', 'duty_ops.view', 'flyvask.view', 'brakkevakt.view'] };
const metadata = { lastSyncedAt: now, stale: false, from: now, to: now };
const duty = (shifts: object[] = []) => ({ from: '2026-09-27', to: '2026-10-27', timeZone: 'Europe/Oslo', shifts,
  sync: { stale: false, warning: null, discovery: metadata, assignments: metadata } });
const flights = (entries: object[] = []) => ({ from: '2026-09-27', to: '2026-10-27', timeZone: 'Europe/Oslo', flights: entries, sync: metadata });
const flyvask = (shifts: object[] = []) => ({ from: '2026-09-27', to: '2026-10-27', timeZone: 'Europe/Oslo', shifts,
  sync: { stale: false, warning: null, discovery: metadata, assignments: metadata } });
const brakkevakt = (weeks: object[] = []) => ({ currentUserId: 'me', currentWeekStart: '2026-09-21', weeks });
const shift = { id: 'duty-one', startsAt: '2026-09-27T10:00:00Z', endsAt: '2026-09-27T14:00:00Z', status: 'OPEN', participantCount: 1,
  participants: [{ userId: 'me', firstName: 'Student', lastName: 'One', isCurrentUser: true }] };
const flight = { id: 'flight-one', startsAt: '2026-09-27T09:00:00Z', endsAt: '2026-09-27T11:00:00Z', status: 'OPEN',
  aircraft: { callSign: 'LN-ABC' }, departureAirport: { name: 'ENVA' }, arrivalAirport: { name: 'ENBO' }, request: null };
let root: Root, host: HTMLDivElement, user: CurrentUser;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date(now));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  user = { ...student };
  vi.spyOn(account, 'useCurrentUser').mockImplementation(() => ({ user, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = () => act(async () => root.render(<MemoryRouter><HomePage /></MemoryRouter>));
const mock = (data: { flights?: object[]; duty?: object[]; flyvask?: object[]; brakkevakt?: object[] } = {}) => {
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/flights') return Response.json(flights(data.flights));
    if (path === '/api/duty-ops') return Response.json(duty(data.duty));
    if (path === '/api/flyvask') return Response.json(flyvask(data.flyvask));
    if (path === '/api/brakkevakt') return Response.json(brakkevakt(data.brakkevakt));
    throw new Error(path);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
};
describe('Home composition', () => {
  it('shows own flights and duties in time order without duplicate module cards', async () => {
    const fetcher = mock({ flights: [flight], duty: [shift] }); await render();
    expect(host.textContent).toContain('My schedule');
    expect(host.textContent).toContain('LN-ABC');
    expect(host.textContent).toContain('Duty Ops');
    expect(host.textContent!.indexOf('Flight')).toBeLessThan(host.textContent!.indexOf('Duty Ops'));
    expect(host.querySelector('.quick-access')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('never requests a module without its view permission', async () => {
    user = { ...student, permissions: ['flights.view'] }; const fetcher = mock({ flights: [flight], duty: [shift] }); await render();
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/flights']);
    expect(host.querySelector('a[href^="/duty-ops"]')).toBeNull();
  });
  it('shows actionable fuel and relevant coverage near the next flight', async () => {
    const dueFlight = { ...flight, request: { status: 'NEEDS_REVIEW' } };
    mock({ flights: [dueFlight], duty: [{ ...shift, startsAt: '2026-09-27T08:00:00Z', participants: [{ userId: 'anna', firstName: 'Anna', lastName: 'Berg', isCurrentUser: false }] }] }); await render();
    expect(host.textContent).toContain('Needs attention');
    expect(host.textContent).toContain('Fuel needs review');
    expect(host.querySelector('.home-item-context')?.textContent).toContain('Duty Ops: Anna Berg');
    expect(host.querySelector('a[href^="/duty-ops/shifts/"]')).toBeNull();
  });
  it('keeps available content when one module fails', async () => {
    const fetcher = mock({ flights: [flight] });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async path => path === '/api/duty-ops' ? Response.json({ error: 'offline' }, { status: 503 }) : original(path));
    await render();
    expect(host.textContent).toContain('LN-ABC');
    expect(host.textContent).toContain('Duty Ops unavailable');
  });
  it('shows a current Brakkevakt duty once with its colleague', async () => {
    const week = { id: 'week-one', weekStart: '2026-09-21', revision: 1, assignments: [
      { id: 'one', slot: 1, user: { id: 'me', firstName: 'Student', lastName: 'One' } },
      { id: 'two', slot: 2, user: { id: 'anna', firstName: 'Anna', lastName: 'Berg' } },
    ] };
    mock({ brakkevakt: [week] }); await render();
    expect(host.querySelector('.home-schedule')?.textContent).toContain('Brakkevakt · Week 39');
    expect(host.querySelector('.home-schedule')?.textContent).toContain('With Anna Berg');
    expect(host.querySelector('.home-schedule')?.textContent).not.toContain('Nothing upcoming');
    expect(host.querySelector('.home-context')?.textContent).not.toContain('Brakkevakt this week');
  });
  it('links the current Brakkevakt week as a compact whole row when assigned to others', async () => {
    const week = { id: 'current', weekStart: '2026-09-21', revision: 1, assignments: [
      { id: 'one', slot: 1, user: { id: 'anna', firstName: 'Anna', lastName: 'Berg' } },
      { id: 'two', slot: 2, user: { id: 'erik', firstName: 'Erik', lastName: 'Eide' } },
    ] };
    mock({ brakkevakt: [week] }); await render();
    const link = host.querySelector<HTMLAnchorElement>('.home-context .home-week a')!;
    expect(link.getAttribute('href')).toBe('/brakkevakt');
    expect(link.querySelector('strong')?.textContent).toBe('Brakkevakt · Week 39');
    expect(link.textContent).toContain('Anna Berg · Erik Eide');
    expect(link.textContent).not.toContain('21 Sep–27 Sep');
  });
  it('keeps all near-term commitments before limiting distant items', async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({ ...flight, id: `today-${index}`, startsAt: new Date(Date.parse(now) + (index + 1) * 3600000).toISOString(), endsAt: new Date(Date.parse(now) + (index + 2) * 3600000).toISOString() }));
    mock({ flights: entries }); await render();
    expect(host.querySelectorAll('.home-day:first-of-type li')).toHaveLength(10);
    expect(host.textContent).not.toContain('Loading schedule…');
  });
  it('shows an Oslo date on every point event under generic Upcoming', async () => {
    mock({
      flights: [{ ...flight, startsAt: '2026-10-04T07:00:00Z', endsAt: '2026-10-04T09:00:00Z' }],
      duty: [{ ...shift, startsAt: '2026-10-05T06:00:00Z', endsAt: '2026-10-05T12:00:00Z' }],
    });
    await render();
    const upcoming = [...host.querySelectorAll('.home-day')].find(group => group.querySelector('h3')?.textContent === 'Upcoming')!;
    const rows = [...upcoming.querySelectorAll('li a')].map(row => ({ title: row.querySelector('strong')?.textContent, detail: row.querySelector('span')?.textContent }));
    expect(rows).toEqual([
      { title: 'Flight', detail: 'Sun 4 Oct · 09:00 · LN-ABC · ENVA → ENBO' },
      { title: 'Duty Ops', detail: 'Mon 5 Oct · 08:00–14:00' },
    ]);
    expect(rows.every(row => /^\w{3} \d{1,2} \w{3}(?: \d{4})? · \d{2}:\d{2}/.test(row.detail ?? ''))).toBe(true);
  });
  it('adds the year when an Upcoming point event crosses into another year', async () => {
    vi.setSystemTime(new Date('2026-12-29T08:00:00Z'));
    mock({ duty: [{ ...shift, startsAt: '2027-01-04T08:00:00Z', endsAt: '2027-01-04T13:00:00Z' }] });
    await render();
    const upcoming = [...host.querySelectorAll('.home-day')].find(group => group.querySelector('h3')?.textContent === 'Upcoming')!;
    expect(upcoming.querySelector('li a span')?.textContent).toBe('Mon 4 Jan 2027 · 09:00–14:00');
  });
  it('keeps point rows concise when a date-specific heading supplies the date', async () => {
    const wash = { id: 'wash', startsAt: '2026-09-28T07:00:00Z', endsAt: '2026-09-28T09:00:00Z', status: 'OPEN', classroomId: '602', classroomName: 'Hangar UTSA', participantCount: 1,
      participants: [{ userId: 'me', firstName: 'Student', lastName: 'One', isCurrentUser: true }], flightlogger: { participants: [{ userId: 'me', firstName: 'Student', lastName: 'One', isCurrentUser: true }], participantCount: 1 }, assignmentsDiffer: false };
    mock({ flyvask: [wash] }); await render();
    const tomorrow = [...host.querySelectorAll('.home-day')].find(group => group.querySelector('h3')?.textContent === 'Tomorrow')!;
    expect(tomorrow.querySelector('li a strong')?.textContent).toBe('Flyvask');
    expect(tomorrow.querySelector('li a span')?.textContent).toBe('09:00');
  });
  it('places a future Brakkevakt week in weekly context', async () => {
    const week = { id: 'future', weekStart: '2026-09-28', revision: 1, assignments: [
      { id: 'one', slot: 1, user: { id: 'me', firstName: 'Student', lastName: 'One' } },
      { id: 'two', slot: 2, user: { id: 'anna', firstName: 'Anna', lastName: 'Berg' } },
    ] };
    mock({ brakkevakt: [week] }); await render();
    expect(host.querySelector('.home-week a[href="/brakkevakt"] strong')?.textContent).toBe('Brakkevakt · Week 40');
    expect(host.querySelector('.home-week')?.textContent).not.toContain('28 Sep–4 Oct');
    expect(host.querySelector('.home-day h3')?.textContent).not.toBe('Today');
  });
});
