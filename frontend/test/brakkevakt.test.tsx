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
let host: HTMLDivElement, root: Root, api: ReturnType<typeof vi.fn>, permissions: string[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); window.scrollTo = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  permissions = ['brakkevakt.view', 'brakkevakt.swap'];
  api = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/me') return Response.json({ email: 'alice@private.test', subject: 'alice', firstName: 'Alice', lastName: 'Andersson',
      onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-a', roles: ['STUDENT'], permissions });
    if (path === '/api/brakkevakt') return Response.json(schedule);
    if (path === '/api/brakkevakt/roster') return Response.json({ students: users });
    if (path === '/api/brakkevakt/swaps') return init.method === 'POST' ? Response.json({ id: 'request' }) : Response.json({ currentUserId: 'a', requests: [], lockedAssignmentIds: [], nextCursor: null });
    if (path === '/api/brakkevakt/swaps/history') return Response.json({ entries: [], nextCursor: null });
    throw new Error(`Unexpected API ${path}`);
  });
  vi.stubGlobal('fetch', api);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(path = '/brakkevakt') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)); }
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }

describe('Brakkevakt portal UI', () => {
  it('shows named current and future teams, personal partner and a direct swap action without email', async () => {
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Brakkevakt');
    expect(host.textContent).toContain('Alice Andersson · Bob Berg');
    expect(host.textContent).toContain('Together with Bob Berg');
    expect(host.textContent).toContain('Carl Carlsson · Student');
    expect(host.querySelector('section.brakkevakt')?.textContent).not.toContain('alice@private.test');
    const button = [...host.querySelectorAll<HTMLButtonElement>('.brakkevakt-week button')].find(b => b.textContent === 'Look for swap')!;
    await click(button);
    expect(api.mock.calls.some(([path, init]) => path === '/api/brakkevakt/swaps' && init?.method === 'POST'
      && JSON.parse(init.body).assignmentId === 'slot-a')).toBe(true);
    expect(host.querySelector('a[href="/brakkevakt/swap-history"]')).toBeNull();
    expect(host.querySelectorAll('.brakkevakt-week')).toHaveLength(2);
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
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Generate rows')!);
    expect(host.querySelectorAll('.brakkevakt-manage-row')).toHaveLength(10);
    expect(host.querySelector('option[value="a"]')?.textContent).toBe('Alice Andersson');
    expect(host.querySelector('option[value="d"]')?.textContent).toBe('Student');
    expect(api.mock.calls.some(([path, init]) => path.includes('/schedule/') && init?.method === 'PUT')).toBe(false);
  });
  it('shows only personal history and neutral missing-name fallback', async () => {
    expect(displayName({ firstName: null, lastName: null })).toBe('Student');
    expect(displayName({ firstName: 'Alice', lastName: null })).toBe('Alice');
    await render('/brakkevakt/swap-history');
    expect(host.textContent).toContain('No accepted activity yet');
    expect(api.mock.calls.some(([path]) => path === '/api/brakkevakt/swaps/history')).toBe(true);
  });
});
