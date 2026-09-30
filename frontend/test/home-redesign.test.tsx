// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import * as account from '../src/app/CurrentUser';
import type { CurrentUser } from '../src/app/current-user-api';
import { greeting, homeItems, startsLabel, weekDays, type HomeSources } from '../src/pages/home-model';

const me = [{ userId: 'me', firstName: 'Ole', lastName: 'Rockstad', isCurrentUser: true }];
const metadata = (at: string) => ({ lastSyncedAt: at, stale: false, from: at, to: at });
const shiftData = (shifts: object[], at = '2026-09-30T10:04:00Z') => ({ from: '2026-09-30', to: '2026-10-30', timeZone: 'Europe/Oslo' as const, shifts,
  sync: { stale: false, warning: null, discovery: metadata(at), assignments: metadata(at) } });
const duty = { id: 'd1', startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T11:00:00Z', status: 'OPEN', participantCount: 3, participants: me };
const wash = { id: 'w1', startsAt: '2026-10-17T16:00:00Z', endsAt: '2026-10-17T18:00:00Z', status: 'OPEN', participantCount: 13, participants: me,
  classroomId: '602', classroomName: 'Hangar UTSA', flightlogger: { participantCount: 13, participants: me }, assignmentsDiffer: false };
const flight = { id: 'f1', startsAt: '2026-10-02T07:00:00Z', endsAt: '2026-10-02T09:00:00Z', flightStartsAt: null, flightEndsAt: null, status: 'OPEN',
  aircraft: { callSign: 'LN-ABC', model: 'Z242L' }, departureAirport: null, arrivalAirport: null, plannedLessons: [], request: null };
const sources = (overrides: Partial<Record<'duty' | 'flyvask' | 'flights', object[]>> = {}) => ({
  duty: shiftData(overrides.duty ?? []), flyvask: shiftData(overrides.flyvask ?? []),
  flights: { from: '2026-09-30', to: '2026-10-30', timeZone: 'Europe/Oslo', flights: overrides.flights ?? [], sync: { lastSyncedAt: '2026-09-30T10:04:00Z', stale: false, warning: null } },
}) as unknown as HomeSources;

describe('Home model', () => {
  it('greets by the Oslo hour', () => {
    expect(greeting(Date.parse('2026-09-30T06:30:00Z'))).toBe('Good morning'); // 08:30 Oslo
    expect(greeting(Date.parse('2026-09-30T10:00:00Z'))).toBe('Good afternoon'); // 12:00 Oslo
    expect(greeting(Date.parse('2026-09-30T16:00:00Z'))).toBe('Good evening'); // 18:00 Oslo
  });
  it('picks the earliest own commitment across Duty Ops, Flyvask and Flights', () => {
    const now = Date.parse('2026-09-30T10:00:00Z');
    const items = homeItems(sources({ flyvask: [wash], flights: [flight], duty: [duty, { ...duty, id: 'other', startsAt: '2026-09-30T12:00:00Z', participants: [{ ...me[0], userId: 'x', isCurrentUser: false }] }] }), now);
    expect(items.map(item => item.id)).toEqual(['duty:d1', 'flight:f1', 'flyvask:w1']);
    expect(items[0]).toMatchObject({ others: 2, path: '/duty-ops/shifts/d1' });
    expect(items[2]).toMatchObject({ others: 12, place: 'Hangar UTSA' });
  });
  it('labels how soon the next commitment starts, or that it is under way', () => {
    const item = { at: Date.parse('2026-10-01T06:00:00Z'), end: Date.parse('2026-10-01T11:00:00Z') };
    expect(startsLabel(item, Date.parse('2026-09-30T10:04:00Z'))).toEqual({ text: 'Starts in 19 h', tone: 'warning' });
    expect(startsLabel(item, Date.parse('2026-10-01T05:35:00Z'))).toEqual({ text: 'Starts in 25 min', tone: 'warning' });
    expect(startsLabel(item, Date.parse('2026-09-27T06:00:00Z'))).toEqual({ text: 'Starts in 4 days', tone: 'warning' });
    expect(startsLabel(item, Date.parse('2026-10-01T07:00:00Z'))).toEqual({ text: 'In progress · ends 13:00', tone: 'soft' });
  });
  it('builds Monday–Sunday of the current Oslo week with the first own item per day', () => {
    const now = Date.parse('2026-09-30T10:00:00Z');
    const days = weekDays(homeItems(sources({ duty: [duty] }), now), now);
    expect(days.map(day => `${day.weekday} ${day.day}`)).toEqual(['Mon 28', 'Tue 29', 'Wed 30', 'Thu 1', 'Fri 2', 'Sat 3', 'Sun 4']);
    expect(days.filter(day => day.today).map(day => day.date)).toEqual(['2026-09-30']);
    expect(days.filter(day => day.first).map(day => day.date)).toEqual(['2026-10-01']);
  });
});

const student: CurrentUser = { email: 'ole@example.test', subject: 'ole', firstName: 'Ole Markus', lastName: 'Rockstad', onboardingComplete: true,
  hasFlightLoggerCredential: true, flightLoggerUserId: 'me', roles: ['STUDENT'], permissions: ['flights.view', 'duty_ops.view', 'duty_ops.swap', 'flyvask.view'] };
let root: Root, host: HTMLDivElement;
const responses = (overrides: { duty?: object[]; flyvask?: object[]; unread?: number; newest?: string } = {}) => {
  const data = sources({ duty: overrides.duty, flyvask: overrides.flyvask });
  return (path: string) => {
    if (path === '/api/flights') return Response.json(data.flights);
    if (path === '/api/duty-ops') return Response.json(data.duty);
    if (path === '/api/flyvask') return Response.json(data.flyvask);
    if (path === '/api/inbox') return Response.json({ items: overrides.newest ? [{ id: 'i', title: overrides.newest, readAt: null }] : [], unreadCount: overrides.unread ?? 0, nextCursor: null });
    throw new Error(path);
  };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date('2026-09-30T10:04:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: student, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = (respond: (path: string) => Response | Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => respond(path)));
  return act(async () => root.render(<MemoryRouter><HomePage /></MemoryRouter>));
};

describe('Home page', () => {
  it('greets the user and renders the approved card order', async () => {
    await render(responses({ duty: [duty], flyvask: [wash] }));
    expect(host.querySelector('h1')?.textContent).toBe('Good afternoon, Ole Markus');
    expect(host.querySelector('.home-subline')?.textContent).toContain('Week 40');
    expect(host.querySelector('.home-subline')?.textContent).toContain('Synced 12:04');
    expect([...host.querySelectorAll('.card')].map(card => card.querySelector('h2')?.textContent)).toEqual(['This week', 'Duty Ops', 'Upcoming', 'Flights', 'Inbox']);
  });
  it('fills Up next with the soonest shift, its countdown, people and actions', async () => {
    await render(responses({ duty: [duty], flyvask: [wash] }));
    const next = host.querySelector('.home-next')!;
    expect(next.querySelector('.home-eyebrow')?.textContent).toBe('Up next · Tomorrow');
    expect(next.querySelector('.home-next-top .chip')?.textContent).toBe('Starts in 19 h');
    expect(next.querySelector('.home-next-meta')?.textContent).toBe('Thu 1 Oct08:00–13:00 · 5 hYou + 2 others');
    expect([...next.querySelectorAll('.home-next-actions a')].map(link => [link.textContent, link.getAttribute('href')]))
      .toEqual([['Open shift', '/duty-ops/shifts/d1'], ['Exchange', '/duty-ops/exchanges']]);
  });
  it('hides Exchange without the module swap permission', async () => {
    vi.mocked(account.useCurrentUser).mockReturnValue({ user: { ...student, permissions: ['duty_ops.view'] }, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
    await render(responses({ duty: [duty] }));
    expect([...host.querySelectorAll('.home-next-actions a')].map(link => link.textContent)).toEqual(['Open shift']);
  });
  it('marks today in the week strip and dots the days with own commitments', async () => {
    await render(responses({ duty: [duty] }));
    const cells = [...host.querySelectorAll('.home-week-day')];
    expect(cells).toHaveLength(7);
    expect(cells.filter(cell => cell.getAttribute('aria-current') === 'date').map(cell => cell.textContent)).toEqual(['Wed30']);
    expect(cells.filter(cell => cell.querySelector('i.has-item')).map(cell => cell.getAttribute('aria-label'))).toEqual(['Thu 1, Duty Ops 08:00–13:00']);
    expect(cells[3].tagName).toBe('A');
    expect(cells[3].getAttribute('href')).toBe('/duty-ops/shifts/d1');
  });
  it('shows attention chips for unread Inbox items, and an all-clear line otherwise', async () => {
    await render(responses({ unread: 3, newest: 'Shift exchange accepted' }));
    expect([...host.querySelectorAll('.home-attention a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([['3 unread in Inbox', '/inbox']]);
    expect(host.querySelector('.home-all-clear')).toBeNull();
    const inbox = [...host.querySelectorAll('.card')].find(card => card.querySelector('h2')?.textContent === 'Inbox')!;
    expect(inbox.textContent).toContain('3 unread');
    expect(inbox.textContent).toContain('Shift exchange accepted');
    await act(async () => root.unmount()); root = createRoot(host);
    await render(responses());
    expect(host.querySelector('.home-attention')).toBeNull();
    expect(host.querySelector('.home-all-clear')?.textContent).toBe('Nothing is waiting on you. No unread messages or fuel reviews.');
  });
  it('shows skeletons until the schedule arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const respond = responses({ duty: [duty] });
    await render(async path => { await gate; return respond(path); });
    expect(host.querySelector('[aria-label="Loading schedule"]')).not.toBeNull();
    expect(host.querySelectorAll('.home-upcoming .skeleton').length).toBeGreaterThan(0);
    expect(host.querySelector('.home-all-clear')).toBeNull();
    await act(async () => { release(); await gate; });
    expect(host.querySelector('[aria-label="Loading schedule"]')).toBeNull();
    expect(host.querySelector('.home-next h2')?.textContent).toBe('Duty Ops');
  });
  it('explains empty Up next, Upcoming, Flights and Inbox', async () => {
    await render(responses());
    const text = host.textContent!;
    for (const expected of ['Nothing scheduled', 'Nothing in the next 30 days', 'No flights in the next 4 weeks', 'Synced 12:04 from FlightLogger', "You're all caught up"])
      expect(text).toContain(expected);
    expect(host.querySelectorAll('.home-week-day i.has-item')).toHaveLength(0);
  });
});
