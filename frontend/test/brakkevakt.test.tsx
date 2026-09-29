// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { displayName } from '../../shared/display-name';

vi.mock('../src/pwa/PwaProvider', () => ({ PwaProvider: ({ children }: { children: ReactNode }) => children }));
const users = [
  { id: 'a', firstName: 'Alice', lastName: 'Andersson' }, { id: 'b', firstName: 'Bob', lastName: 'Berg' },
  { id: 'c', firstName: 'Carl', lastName: 'Carlsson' }, { id: 'd', firstName: null, lastName: null },
];
const schedule = { currentUserId: 'a', currentWeekStart: '2026-09-28', weeks: [
  { id: 'week-1', weekStart: '2026-09-28', revision: 1, assignments: [{ id: 'slot-a', slot: 1, user: users[0] }, { id: 'slot-b', slot: 2, user: users[1] }] },
  { id: 'week-2', weekStart: '2026-10-05', revision: 1, assignments: [{ id: 'slot-c', slot: 1, user: users[2] }, { id: 'slot-d', slot: 2, user: users[3] }] },
] };
let host: HTMLDivElement, root: Root, api: ReturnType<typeof vi.fn>, permissions: string[], swapRequests: object[], locks: string[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); window.scrollTo = vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  permissions = ['brakkevakt.view', 'brakkevakt.swap'];
  swapRequests = []; locks = [];
  api = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/me') return Response.json({ email: 'alice@private.test', subject: 'alice', firstName: 'Alice', lastName: 'Andersson',
      onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-a', roles: ['STUDENT'], permissions });
    if (path.startsWith('/api/exchanges/v2/intents?')) return Response.json({ domain: 'BRAKKEVAKT', currentUserId: 'a', timeZone: 'Europe/Oslo',
      intents: [], candidates: [], assignmentStates: schedule.weeks.flatMap(week => week.assignments.map(slot => ({
        assignmentId: slot.id, relationship: slot.user.id === 'a' ? 'OWN_IDLE' : 'NONE',
        availableActions: slot.user.id === 'a' && !locks.includes(slot.id) ? ['OPEN_EXCHANGE'] : [],
        relatedIntentIds: [], relatedCandidateIds: [], requestableSourceAssignmentIds: [], requestableSourceAssignments: [], offerableIntentIds: [],
      }))) });
    if (path === '/api/brakkevakt') return Response.json(schedule);
    if (path === '/api/brakkevakt/roster') return Response.json({ students: users });
    if (path.startsWith('/api/brakkevakt/schedule/') && init.method === 'PUT') return Response.json({ revision: 1 });
    if (path === '/api/brakkevakt/swaps') return init.method === 'POST' ? Response.json({ id: 'request' }) : Response.json({ currentUserId: 'a', requests: swapRequests, lockedAssignmentIds: locks, nextCursor: null });
    if (path === '/api/exchanges/v2/intents' && init.method === 'POST') return Response.json({ id: 'intent' });
    if (path === '/api/brakkevakt/swaps/history') return Response.json({ entries: [], nextCursor: null });
    throw new Error(`Unexpected API ${path}`);
  });
  vi.stubGlobal('fetch', api);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(path = '/brakkevakt') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)); }
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }

describe('Brakkevakt portal UI', () => {
  it('keeps an own active swap and incoming offer visible on the week', async () => {
    swapRequests = [{ id: 'request', requester: users[0], requestedAssignmentId: 'slot-a', requestedWeekStart: '2026-09-28', status: 'OPEN', eligible: true, createdAt: '2026-09-28T07:00:00Z',
      proposals: [{ id: 'offer', proposer: users[2], offeredAssignmentId: 'slot-c', offeredWeekStart: '2026-10-05', status: 'OPEN', eligible: true, createdAt: '2026-09-28T07:00:00Z' }] }];
    locks = ['slot-a']; await render();
    const row = host.querySelector('.brakkevakt-week.brakkevakt-mine')!;
    expect(row.textContent).toContain('Looking for swap · 1 offer');
    expect(row.querySelector('button')?.textContent).toBe('Cancel');
    expect(row.querySelector('a[href^="/brakkevakt/exchanges#"]')?.textContent).toBe('Review offers');
  });
  it('starts a v2 week exchange without posting to the old endpoint', async () => {
    swapRequests = [{ id: 'request', requester: users[2], requestedAssignmentId: 'slot-c', requestedWeekStart: '2026-10-05', status: 'OPEN', eligible: true, createdAt: '2026-09-28T07:00:00Z', proposals: [] }];
    await render();
    await click([...host.querySelectorAll<HTMLButtonElement>('.brakkevakt-week button')].find(button => button.textContent === 'Exchange')!);
    expect(host.querySelector('dialog')?.textContent).toContain('Your assignment');
    expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('dialog select')).toBeNull();
    await click([...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Post exchange')!);
    expect(JSON.parse(api.mock.calls.find(([path, init]) => path === '/api/exchanges/v2/intents' && init?.method === 'POST')![1].body))
      .toMatchObject({ domain: 'BRAKKEVAKT', sourceAssignmentId: 'slot-a', allowGiveAway: false });
  });
  it('keeps sent offers on the own week and hides a repeat offer action', async () => {
    swapRequests = [{ id: 'request', requester: users[2], requestedAssignmentId: 'slot-c', requestedWeekStart: '2026-10-05', status: 'OPEN', eligible: true, createdAt: '2026-09-28T07:00:00Z',
      proposals: [{ id: 'offer', proposer: users[0], offeredAssignmentId: 'slot-a', offeredWeekStart: '2026-09-28', status: 'OPEN', eligible: true, createdAt: '2026-09-28T07:00:00Z' }] }];
    locks = ['slot-a']; await render();
    expect(host.querySelector('.brakkevakt-week.brakkevakt-mine')?.textContent).toContain('Offer sent');
    await act(async () => host.querySelector<HTMLAnchorElement>('a[href^="/brakkevakt/exchanges#"]')!.click());
    expect(host.querySelector('.exchange-row')?.textContent).not.toContain('Offer a week');
    expect(host.querySelector('.exchange-row')?.textContent).toContain('Withdraw offer');
  });
  it('shows named current and future teams, personal partner and a direct swap action without email', async () => {
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Brakkevakt');
    expect(host.textContent).toContain('Alice Andersson · Bob Berg');
    expect(host.textContent).toContain('Week 40 · 28 Sep–4 Oct');
    expect(host.textContent).not.toContain('Together with Bob Berg');
    expect(host.textContent).toContain('Carl Carlsson · Student');
    expect(host.querySelector('section.brakkevakt')?.textContent).not.toContain('alice@private.test');
    const button = [...host.querySelectorAll<HTMLButtonElement>('.brakkevakt-week button')].find(b => b.textContent === 'Exchange')!;
    await click(button);
    expect(host.querySelector('dialog')?.textContent).toContain('Available exchanges');
    expect(api.mock.calls.some(([path, init]) => path === '/api/brakkevakt/swaps' && init?.method === 'POST')).toBe(false);
    await click([...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(b => b.textContent === 'Post exchange')!);
    expect(api.mock.calls.some(([path, init]) => path === '/api/exchanges/v2/intents' && init?.method === 'POST'
      && JSON.parse(init.body).sourceAssignmentId === 'slot-a')).toBe(true);
    expect(host.querySelector('a[href="/brakkevakt/swap-history"]')).toBeNull();
    expect(host.querySelectorAll('.brakkevakt-week')).toHaveLength(4);
    expect(host.querySelector('a[href="/brakkevakt/manage"]')).toBeNull();
  });
  it('allows a designated student manager to prepare 10 unsaved weeks from a name-only roster', async () => {
    permissions.push('brakkevakt.manage_schedule');
    await render('/brakkevakt/manage');
    expect(host.querySelector('h1')?.textContent).toBe('Manage Brakkevakt');
    expect(host.querySelector('a[href="/brakkevakt"]')).not.toBeNull();
    expect(host.querySelector('input[type="date"]')).toBeNull();
    expect(host.querySelector('.brakkevakt-generator select')).not.toBeNull();
    expect(host.querySelectorAll('.brakkevakt-manage-row')).toHaveLength(2);
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Generate weeks')!);
    expect(host.querySelectorAll('.brakkevakt-manage-row')).toHaveLength(10);
    expect(host.querySelector('option[value="a"]')?.textContent).toBe('Alice Andersson');
    expect(host.querySelector('option[value="d"]')?.textContent).toBe('Student');
    expect(api.mock.calls.some(([path, init]) => path.includes('/schedule/') && init?.method === 'PUT')).toBe(false);
  });
  it('saves only completed changed weeks from the manager', async () => {
    permissions.push('brakkevakt.manage_schedule'); await render('/brakkevakt/manage');
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Save changes')!;
    expect(save.disabled).toBe(true);
    const first = host.querySelector<HTMLSelectElement>('.brakkevakt-manage-row select')!;
    await act(async () => { first.value = 'c'; first.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(save.disabled).toBe(false);
    await click(save);
    expect(api.mock.calls.filter(([path, init]) => path.includes('/schedule/') && init?.method === 'PUT')).toHaveLength(1);
    expect(save.disabled).toBe(true);
  });
  it('shows only personal history and neutral missing-name fallback', async () => {
    expect(displayName({ firstName: null, lastName: null })).toBe('Student');
    expect(displayName({ firstName: 'Alice', lastName: null })).toBe('Alice');
    await render('/brakkevakt/swap-history');
    expect(host.textContent).toContain('No accepted activity yet');
    expect(api.mock.calls.some(([path]) => path === '/api/brakkevakt/swaps/history')).toBe(true);
  });
});
