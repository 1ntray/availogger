// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyOpsPage } from '../src/pages/DutyOpsPage';
import { DutySwapHistoryPage } from '../src/pages/DutySwapHistoryPage';
import { HomeDutyOps } from '../src/features/duty-ops/HomeDutyOps';
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
  it('shows primary Studentportal and secondary FlightLogger participants with privacy-safe unknown counts', async () => {
    await render(<ShiftList shifts={[shift]} />);
    const labels = host.querySelectorAll('.duty-participants');
    expect(labels[0].textContent).toContain('StudentportalSimon · 2 others');
    expect(labels[1].textContent).toContain('FlightLoggerAnna · 2 others');
    expect(host.querySelector('.sr-only')!.textContent).toBe('Your shift');
    expect(host.querySelector('time')!.getAttribute('datetime')).toBe(shift.startsAt);
  });
  it('keeps unchanged FlightLogger source compact and validates new fields', async () => {
    await render(<ShiftList shifts={[{ ...shift, assignmentsDiffer: false, flightlogger: { participants: [me], participantCount: 3 } }]} />);
    expect(host.querySelectorAll('.duty-participants')).toHaveLength(1);
    expect(host.textContent).toContain('FlightLogger'); expect(host.textContent).not.toContain('Studentportal');
    expect(isDutyOpsData(data)).toBe(true);
    expect(isDutyOpsData({ ...data, shifts: [{ ...shift, flightlogger: { participantCount: -1, participants: [] } }] })).toBe(false);
  });
  it('uses acquired shifts for Home personal relevance and excludes a given-away raw shift', async () => {
    const lost = { ...shift, id: 'lost', startsAt: '2026-09-27T15:00:00.000Z', endsAt: '2026-09-27T18:00:00.000Z', participants: [anna], flightlogger: { participantCount: 3, participants: [me] } };
    // No Today entries: next personal shift must come from primary memberships.
    lost.startsAt = '2026-09-28T03:00:00.000Z'; lost.endsAt = '2026-09-28T04:00:00.000Z';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...data, shifts: [lost, shift] })));
    await render(<HomeDutyOps now={now} />);
    expect(host.textContent).toContain('Your next Duty Ops');
    expect(host.querySelector('time')!.getAttribute('datetime')).toBe(shift.startsAt);
    expect(host.textContent).toContain('Studentportal'); expect(host.textContent).not.toContain('05:00–06:00');
  });
  it('refreshes effective My shifts immediately after a successful give-away claim', async () => {
    let claimed = false;
    const request = { id: 'request', type: 'GIVE_AWAY', status: 'OPEN', requester: { id: 'anna', firstName: 'Anna', lastName: null },
      requestedShift: shift, acceptedBy: null, acceptedProposalId: null, createdAt: new Date(now).toISOString(), acceptedAt: null, proposals: [], eligible: true };
    const fetcher = vi.fn(async (path: string, init: RequestInit) => {
      if (init.method === 'POST') { claimed = true; return Response.json({ id: 'request' }); }
      if (path === '/api/duty-ops') return Response.json({ ...data, shifts: [claimed ? shift : { ...shift, participants: [anna], assignmentsDiffer: false }] });
      return Response.json({ currentUserId: 'me', requests: claimed ? [] : [request], lockedShiftIds: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher); await render(<DutyOpsPage />);
    expect(host.querySelector('[aria-labelledby=duty-mine]')!.textContent).toContain('No upcoming shifts');
    await click('Take shift'); await click('Take shift');
    expect(host.querySelector('[aria-labelledby=duty-mine]')!.textContent).toContain('StudentportalSimon');
    expect(host.querySelector('.duty-exchanges')!.textContent).not.toContain('Take shift');
    expect(host.textContent).toContain('Exchange shift');
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/duty-ops')).toHaveLength(2);
  });
});

describe('Swap history route and personal presentation', () => {
  it('is bookmarkable, exposes current-page navigation, and orients both direct-swap shifts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [history], nextCursor: null })));
    await act(async () => root.render(<MemoryRouter initialEntries={['/duty-ops/swap-history']}><Routes>
      <Route path="/duty-ops/swap-history" element={<DutySwapHistoryPage />} />
      <Route path="/duty-ops" element={<p>Overview page</p>} />
    </Routes></MemoryRouter>));
    expect(host.querySelector('a[aria-current=page]')!.textContent).toBe('Swap history');
    expect(host.textContent).toContain('Swapped with Anna');
    expect(host.querySelector('.swap-history-shifts')!.textContent).toMatch(/You gaveTue,? 29 Sept 2026/);
    expect(host.querySelector('.swap-history-shifts')!.textContent).toMatch(/You receivedMon,? 28 Sept 2026/);
    expect(host.textContent).toContain('FlightLogger is not updated automatically');
    expect(host.querySelectorAll('.swap-history time')).toHaveLength(3);
    await act(async () => host.querySelector<HTMLAnchorElement>('a[href="/duty-ops"]')!.click());
    expect(host.textContent).toBe('Overview page');
  });
  it('shows gave/took direction, trusted fallback and separate entries for a chain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [
      { ...history, id: 'gave', type: 'GIVE_AWAY', receivedShift: null },
      { ...history, id: 'took', type: 'GIVE_AWAY', givenShift: null, counterparty: { id: 'carl', firstName: null, lastName: null } },
    ], nextCursor: null })));
    await render(<DutySwapHistoryPage />);
    expect(host.textContent).toContain('Gave shift to Anna'); expect(host.textContent).toContain('Took shift from Student');
    expect(host.querySelectorAll('.swap-history > li')).toHaveLength(2);
  });
  it('loads keyset pages using relative no-store URLs and keeps errors retryable', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ entries: [history], nextCursor: 'cursor|id' }))
      .mockResolvedValueOnce(Response.json({ entries: [{ ...history, id: 'older' }], nextCursor: null }));
    vi.stubGlobal('fetch', fetcher); await render(<DutySwapHistoryPage />); await click('Load more history');
    expect(host.querySelectorAll('.swap-history > li')).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toBe('/api/duty-ops/swaps/history?cursor=cursor%7Cid');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    fetcher.mockResolvedValueOnce(Response.json({ error: 'History unavailable' }, { status: 503 }));
    await click('Reload'); expect(host.querySelector('[role=alert]')!.textContent).toBe('History unavailable');
  });
  it('validates response shape rather than rendering malformed history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [{ ...history, givenShift: null }], nextCursor: null })));
    await expect(loadSwapHistory(new AbortController().signal)).rejects.toThrow('unexpected');
  });
});
