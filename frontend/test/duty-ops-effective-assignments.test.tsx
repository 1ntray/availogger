// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyOpsPage } from '../src/pages/DutyOpsPage';
import { MyActivityPage } from '../src/pages/MyActivityPage';
import { ShiftList } from '../src/features/duty-ops/ShiftList';
import { isDutyOpsData } from '../src/features/duty-ops/api';
import { loadSwapHistory } from '../src/features/duty-ops/exchange-api';
import type { DutyShift, DutyOpsData } from '../src/features/duty-ops/types';
import type { ExchangeHistoryEntry } from '../../shared/duty-ops-swaps';

const now = Date.parse('2026-09-27T08:00:00.000Z');
const me = { userId: 'me', firstName: 'Simon', lastName: null, isCurrentUser: true };
const anna = { userId: 'anna', firstName: 'Anna', lastName: null, isCurrentUser: false };
const shift: DutyShift = { id: 'received', startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T10:00:00.000Z', status: 'OPEN',
  participantCount: 3, participants: [me], flightlogger: { participantCount: 3, participants: [anna] }, assignmentsDiffer: true };
const metadata = { lastSyncedAt: new Date(now).toISOString(), from: '2026-08-27T22:00:00.000Z', to: '2026-11-27T23:00:00.000Z', stale: false };
const data: DutyOpsData = { from: '2026-08-28', to: '2026-11-27', timeZone: 'Europe/Oslo', shifts: [shift], sync: { stale: false, warning: null, assignments: metadata, discovery: metadata } };
const history: ExchangeHistoryEntry = { id: 'exchange', type: 'DIRECT_SWAP', counterparty: { id: 'anna', firstName: 'Anna', lastName: null },
  givenShift: { id: null, startsAt: '2026-09-29T05:00:00.000Z', endsAt: '2026-09-29T10:00:00.000Z' }, receivedShift: shift, acceptedAt: new Date(now).toISOString() };
const refresh = vi.fn(async () => {});
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { subject: 'me', permissions: ['duty_ops.view', 'duty_ops.swap'] }, refresh }) }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(element: React.ReactNode) { await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>)); }
async function click(text: string) {
  const button = [...(host.querySelector('dialog') ?? host).querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  expect(button).toBeDefined(); expect(button.disabled).toBe(false); await act(async () => button.click());
}

describe('effective Duty Ops presentation', () => {
  it('shows effective participants first and reveals differing FlightLogger data on demand', async () => {
    await render(<ShiftList shifts={[shift]} />);
    const labels = host.querySelectorAll('.duty-participants');
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe('Simon · 2 others');
    const details = host.querySelector<HTMLDetailsElement>('.attention-detail')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('Assignments differ from FlightLogger');
    await act(async () => details.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(details.textContent).toContain('FlightLogger records: Anna · 2 others');
    expect(host.querySelector('.sr-only')!.textContent).toBe('Your shift');
    expect(host.querySelector('time')!.getAttribute('datetime')).toBe(shift.startsAt);
  });
  it('keeps unchanged FlightLogger source compact and validates new fields', async () => {
    await render(<ShiftList shifts={[{ ...shift, assignmentsDiffer: false, flightlogger: { participants: [me], participantCount: 3 } }]} />);
    expect(host.querySelectorAll('.duty-participants')).toHaveLength(1);
    expect(host.querySelector('.attention-detail')).toBeNull();
    expect(isDutyOpsData(data)).toBe(true);
    expect(isDutyOpsData({ ...data, shifts: [{ ...shift, flightlogger: { participantCount: -1, participants: [] } }] })).toBe(false);
  });
  it('refreshes effective My shifts immediately after a successful give-away claim', async () => {
    let claimed = false;
    const request = { id: 'request', type: 'GIVE_AWAY', status: 'OPEN', requester: { id: 'anna', firstName: 'Anna', lastName: null },
      requestedShift: shift, acceptedBy: null, acceptedProposalId: null, createdAt: new Date(now).toISOString(), acceptedAt: null, proposals: [], eligible: true };
    const fetcher = vi.fn(async (path: string, init: RequestInit) => {
      if (init.method === 'POST') { claimed = true; return Response.json({ id: 'request' }); }
      if (path === '/api/duty-ops') return Response.json({ ...data, shifts: [claimed ? shift : { ...shift, participants: [anna], assignmentsDiffer: false }] });
      return Response.json({ currentUserId: 'me', currentUserCreditBalance: claimed ? 1 : 0, requests: claimed ? [] : [request], lockedShiftIds: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher); await render(<DutyOpsPage />);
    expect(host.querySelector('[aria-labelledby=duty-mine]')!.textContent).toContain('No upcoming shifts');
    await click('Take shift'); await click('Take shift');
    expect(host.querySelector('[aria-labelledby=duty-mine]')!.textContent).toContain('Simon · 2 others');
    expect(host.querySelector('.duty-exchanges')).toBeNull();
    expect(host.querySelector('a[href="/duty-ops/shifts/received"]')).not.toBeNull();
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/duty-ops')).toHaveLength(2);
  });
  it('offers exchange on an own overview row and keeps other rows out of protected workspaces', async () => {
    const other = { ...shift, id: 'other', startsAt: '2026-09-29T05:00:00Z', endsAt: '2026-09-29T10:00:00Z', participants: [anna], assignmentsDiffer: false };
    const request = { id: 'request', type: 'GIVE_AWAY', status: 'OPEN', requester: { id: 'anna', firstName: 'Anna', lastName: null },
      requestedShift: other, acceptedBy: null, acceptedProposalId: null, createdAt: new Date(now).toISOString(), acceptedAt: null, proposals: [], eligible: true };
    vi.stubGlobal('fetch', vi.fn(async (path: string) => Response.json(path === '/api/duty-ops' ? { ...data, shifts: [shift, other] }
      : { currentUserId: 'me', currentUserCreditBalance: 0, requests: [request], lockedShiftIds: [], nextCursor: null })));
    await render(<DutyOpsPage />);
    expect(host.querySelector('a[href="/duty-ops/shifts/received"]')).not.toBeNull();
    expect(host.querySelector('a[href="/duty-ops/shifts/other"]')).toBeNull();
    expect([...host.querySelectorAll('h2')].map(h => h.textContent)).toEqual(['My upcoming shifts', 'Exchanges', 'Upcoming schedule']);
    expect(host.querySelectorAll('[aria-labelledby="duty-mine"] .is-mine')).toHaveLength(1);
    expect(host.querySelectorAll('.duty-schedule .is-mine')).toHaveLength(1);
    expect(host.querySelector('.duty-schedule .is-mine')?.textContent).toContain('Simon · 2 others');
    const action = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Exchange')!;
    await act(async () => { action.focus(); action.click(); });
    expect(host.querySelector('dialog')).not.toBeNull();
    expect(host.querySelector('dialog')?.textContent).toContain('Available exchanges');
    await click('Post my assignment for swap');
    expect(host.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.disabled).toBe(false);
    await click('Cancel');
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(action);
  });
});

describe('My activity Duty Ops presentation', () => {
  it('orients both direct-swap shifts in personal activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [history], nextCursor: null })));
    await render(<MyActivityPage />);
    expect(host.querySelector('h1')?.textContent).toBe('My activity');
    expect(host.textContent).toContain('Swapped with Anna');
    expect(host.textContent).toContain('Gave Tue');
    expect(host.textContent).toContain('Received Mon');
    expect(host.querySelector('.activity-list time')?.getAttribute('datetime')).toBe(history.acceptedAt);
  });
  it('shows gave/took direction, trusted fallback and separate entries for a chain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [
      { ...history, id: 'gave', type: 'GIVE_AWAY', receivedShift: null },
      { ...history, id: 'took', type: 'GIVE_AWAY', givenShift: null, counterparty: { id: 'carl', firstName: null, lastName: null } },
    ], nextCursor: null })));
    await render(<MyActivityPage />);
    expect(host.textContent).toContain('Gave shift to Anna'); expect(host.textContent).toContain('Took shift from Student');
    expect(host.querySelectorAll('.activity-list > li')).toHaveLength(2);
  });
  it('loads keyset pages using relative no-store URLs and keeps errors retryable', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ entries: [history], nextCursor: 'cursor|id' }))
      .mockResolvedValueOnce(Response.json({ entries: [{ ...history, id: 'older' }], nextCursor: null }));
    vi.stubGlobal('fetch', fetcher); await render(<MyActivityPage />); await click('Load more Duty Ops');
    expect(host.querySelectorAll('.activity-list > li')).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toBe('/api/duty-ops/swaps/history?cursor=cursor%7Cid');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    fetcher.mockResolvedValueOnce(Response.json({ error: 'History unavailable' }, { status: 503 }));
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Refresh activity"]')!.click(); });
    expect(host.querySelector('[role=alert]')!.textContent).toContain('History unavailable');
  });
  it('validates response shape rather than rendering malformed history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [{ ...history, givenShift: null }], nextCursor: null })));
    await expect(loadSwapHistory(new AbortController().signal)).rejects.toThrow('unexpected');
  });
});
