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
const flight = { id: 'flight-one', startsAt: '2026-09-27T09:00:00Z', endsAt: '2026-09-27T11:00:00Z',
  flightStartsAt:'2026-09-27T09:30:00Z',flightEndsAt:'2026-09-27T10:30:00Z',status: 'OPEN',
  aircraft: { callSign: 'LN-ABC',model:'Z242L' }, departureAirport: { name: 'ENVA' }, arrivalAirport: { name: 'ENBO' },
  plannedLessons:[{trainingId:'tr-1',trainingName:'4.2 Instrument approaches',lectureId:null,lectureName:null}],request: null };
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
const mock = (data: { flights?: object[]; duty?: object[]; flyvask?: object[]; brakkevakt?: object[]; unread?: number } = {}) => {
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/flights') return Response.json(flights(data.flights));
    if (path === '/api/duty-ops') return Response.json(duty(data.duty));
    if (path === '/api/flyvask') return Response.json(flyvask(data.flyvask));
    if (path === '/api/brakkevakt') return Response.json(brakkevakt(data.brakkevakt));
    if (path === '/api/inbox') return Response.json({ items: [], unreadCount: data.unread ?? 0, nextCursor: null });
    throw new Error(path);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
};
const rows = () => [...host.querySelectorAll('.home-upcoming .home-row')].map(row => ({
  date: row.querySelector('.date-block')?.textContent, title: row.querySelector('.home-row-text strong')?.textContent, meta: row.querySelector('.home-row-text span')?.textContent }));
const brakkevaktCard = () => [...host.querySelectorAll('.card')].find(card => card.querySelector('h2')?.textContent === 'Brakkevakt')!;
describe('Home composition', () => {
  it('shows own flights and duties in time order without duplicate module cards', async () => {
    const fetcher = mock({ flights: [flight], duty: [shift] }); await render();
    expect(rows().map(row => row.title)).toEqual(['Flight', 'Duty Ops']);
    expect(host.querySelector('.home-next h2')?.textContent).toBe('Flight');
    expect(host.textContent).toContain('LN-ABC');
    expect(host.querySelector('.quick-access')).toBeNull();
    expect(fetcher.mock.calls.map(call => call[0]).sort()).toEqual(['/api/brakkevakt', '/api/duty-ops', '/api/flights', '/api/flyvask', '/api/inbox']);
  });
  it('never requests a module without its view permission', async () => {
    user = { ...student, permissions: ['flights.view'] }; const fetcher = mock({ flights: [flight], duty: [shift] }); await render();
    expect(fetcher.mock.calls.map(call => call[0]).sort()).toEqual(['/api/flights', '/api/inbox']);
    expect(host.querySelector('a[href^="/duty-ops"]')).toBeNull();
    expect(brakkevaktCard()).toBeUndefined();
  });
  it('shows actionable fuel without repeating Duty Ops coverage in a flight row', async () => {
    const dueFlight = { ...flight, request: { status: 'NEEDS_REVIEW' } };
    mock({ flights: [dueFlight], duty: [{ ...shift, startsAt: '2026-09-27T08:00:00Z', participants: [{ userId: 'anna', firstName: 'Anna', lastName: 'Berg', isCurrentUser: false }] }] }); await render();
    expect(host.querySelector('.home-attention a[href="/flights"]')?.textContent).toBe('Fuel needs review · LN-ABC');
    expect(host.querySelector('a[href^="/duty-ops/shifts/"]')).toBeNull();
    const row = host.querySelector('.home-upcoming a[href="/flights"]')!;
    expect(row.textContent).toContain('11:00 Brief · 11:30–12:30 Flight');
    expect(row.textContent).toContain('4.2 Instrument approaches');
    expect(row.textContent).not.toMatch(/ENVA|ENBO|Z242L/);
  });
  it('keeps available content when one module fails', async () => {
    const fetcher = mock({ flights: [flight] });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async path => path === '/api/duty-ops' ? Response.json({ error: 'offline' }, { status: 503 }) : original(path));
    await render();
    expect(host.textContent).toContain('LN-ABC');
    expect(host.querySelector('.home-errors')?.textContent).toBe('Duty Ops unavailable. Open a module to retry.');
  });
  it('shows a current Brakkevakt duty once with its colleague', async () => {
    const week = { id: 'week-one', weekStart: '2026-09-21', revision: 1, assignments: [
      { id: 'one', slot: 1, user: { id: 'me', firstName: 'Student', lastName: 'One' } },
      { id: 'two', slot: 2, user: { id: 'anna', firstName: 'Anna', lastName: 'Berg' } },
    ] };
    mock({ brakkevakt: [week] }); await render();
    expect(brakkevaktCard().textContent).toContain('Week 39 · this week');
    expect(brakkevaktCard().textContent).toContain('with Anna Berg');
    expect(host.querySelector('.home-week-bar')?.textContent).toContain('Brakkevakt all week · with Anna Berg');
    expect(host.textContent).not.toContain('Brakkevakt this week');
  });
  it('links the current Brakkevakt week in the week strip when assigned to others', async () => {
    const week = { id: 'current', weekStart: '2026-09-21', revision: 1, assignments: [
      { id: 'one', slot: 1, user: { id: 'anna', firstName: 'Anna', lastName: 'Berg' } },
      { id: 'two', slot: 2, user: { id: 'erik', firstName: 'Erik', lastName: 'Eide' } },
    ] };
    mock({ brakkevakt: [week] }); await render();
    const bar = host.querySelector('.home-week-bar')!;
    expect(bar.textContent).toContain('Brakkevakt this week · Anna Berg · Erik Eide');
    expect(bar.querySelector('a')?.getAttribute('href')).toBe('/brakkevakt');
    expect(brakkevaktCard().textContent).toContain('No Brakkevakt week assigned');
  });
  it('limits Upcoming to the six soonest commitments', async () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({ ...flight, id: `today-${index}`, startsAt: new Date(Date.parse(now) + (index + 1) * 3600000).toISOString(), endsAt: new Date(Date.parse(now) + (index + 2) * 3600000).toISOString() }));
    mock({ flights: entries }); await render();
    expect(rows()).toHaveLength(6);
    expect(host.querySelector('.home-upcoming .home-row')?.getAttribute('href')).toBe('/flights');
    expect(host.querySelector('[aria-label="Loading schedule"]')).toBeNull();
  });
  it('shows an Oslo date on every Upcoming row', async () => {
    mock({
      flights: [{ ...flight, startsAt: '2026-10-04T07:00:00Z', endsAt: '2026-10-04T09:00:00Z',
        flightStartsAt:'2026-10-04T07:30:00Z',flightEndsAt:'2026-10-04T08:30:00Z' }],
      duty: [{ ...shift, startsAt: '2026-10-05T06:00:00Z', endsAt: '2026-10-05T12:00:00Z' }],
    });
    await render();
    expect(rows()).toEqual([
      { date: 'Sun4Oct', title: 'Flight', meta: '09:00 Brief · 09:30–10:30 Flight · End 11:00 · LN-ABC · 4.2 Instrument approaches' },
      { date: 'Mon5Oct', title: 'Duty Ops', meta: '08:00–14:00 · Only you' },
    ]);
  });
  it('adds the year when the next commitment falls in another year', async () => {
    vi.setSystemTime(new Date('2026-12-29T08:00:00Z'));
    mock({ duty: [{ ...shift, startsAt: '2027-01-04T08:00:00Z', endsAt: '2027-01-04T13:00:00Z' }] });
    await render();
    expect(host.querySelector('.home-next-meta')?.textContent).toContain('Mon 4 Jan 2027');
    expect(host.querySelector('.home-next-meta')?.textContent).toContain('09:00–14:00 · 5 h');
  });
  it('keeps Flyvask rows concise with the place and people', async () => {
    const wash = { id: 'wash', startsAt: '2026-09-28T07:00:00Z', endsAt: '2026-09-28T09:00:00Z', status: 'OPEN', classroomId: '602', classroomName: 'Hangar UTSA', participantCount: 1,
      participants: [{ userId: 'me', firstName: 'Student', lastName: 'One', isCurrentUser: true }], flightlogger: { participants: [{ userId: 'me', firstName: 'Student', lastName: 'One', isCurrentUser: true }], participantCount: 1 }, assignmentsDiffer: false };
    mock({ flyvask: [wash] }); await render();
    expect(rows()).toEqual([{ date: 'Mon28Sept', title: 'Flyvask', meta: '09:00–11:00 · Hangar UTSA · Only you' }]);
    expect(host.querySelector('.home-eyebrow')?.textContent).toBe('Up next · Tomorrow');
  });
  it('places a future Brakkevakt week in weekly context', async () => {
    const week = { id: 'future', weekStart: '2026-09-28', revision: 1, assignments: [
      { id: 'one', slot: 1, user: { id: 'me', firstName: 'Student', lastName: 'One' } },
      { id: 'two', slot: 2, user: { id: 'anna', firstName: 'Anna', lastName: 'Berg' } },
    ] };
    mock({ brakkevakt: [week] }); await render();
    expect(brakkevaktCard().querySelector('a[href="/brakkevakt"] strong')?.textContent).toBe('Week 40');
    expect(host.querySelector('.home-week-bar')).toBeNull();
    expect(host.querySelector('.home-next')?.textContent).toContain('Nothing scheduled');
  });
});
