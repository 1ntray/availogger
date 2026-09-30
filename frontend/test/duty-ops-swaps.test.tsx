// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DutyExchanges, ExchangeShiftActions } from '../src/features/duty-ops/DutyExchanges';
import { ShiftList } from '../src/features/duty-ops/ShiftList';
import { loadExchanges, saveExchange } from '../src/features/duty-ops/exchange-api';
import type { DutyShift } from '../src/features/duty-ops/types';
import type { ExchangeRequest, ExchangeProposal, ExchangesResponse } from '../../shared/duty-ops-swaps';
import type { PermissionKey } from '../../shared/authorization';

let permissions: PermissionKey[];
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { permissions } }) }));
const now = Date.parse('2026-09-27T08:00:00Z');
const own: DutyShift = { id: 'own', startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T10:00:00.000Z', status: 'OPEN', participantCount: 1,
  participants: [{ userId: 'me', firstName: 'Simon', lastName: 'Student', isCurrentUser: true }] };
const anna = { id: 'anna', firstName: 'Anna', lastName: 'Student' }, erik = { id: 'erik', firstName: 'Erik', lastName: 'Student' };
const offered = { id: 'anna-shift', startsAt: '2026-09-29T10:00:00.000Z', endsAt: '2026-09-29T16:00:00.000Z' };
const makeRequest = (changes: Partial<ExchangeRequest> = {}): ExchangeRequest => ({ id: 'request', type: 'GIVE_AWAY', status: 'OPEN', requester: anna,
  requestedShift: offered, acceptedBy: null, acceptedProposalId: null, createdAt: '2026-09-27T07:00:00.000Z', acceptedAt: null, proposals: [], eligible: true, ineligibleReason: null, ...changes });
const makeProposal = (changes: Partial<ExchangeProposal> = {}): ExchangeProposal => ({ id: 'proposal', proposer: anna, offeredShift: offered, status: 'OPEN', createdAt: '2026-09-27T07:00:00.000Z', eligible: true, ...changes });
let data: ExchangesResponse, host: HTMLDivElement, root: Root;
let writes: { path: string; body: Record<string, unknown> }[];
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  permissions = ['duty_ops.view', 'duty_ops.swap'];
  data = { currentUserId: 'me', currentUserCreditBalance: 0, requests: [], lockedShiftIds: [], nextCursor: null }; writes = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom does not implement the native dialog API. Browser QA checks real dialogs.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetcher = vi.fn(async (path: string, init: RequestInit) => {
    if (init.method !== 'POST') return Response.json(data);
    const body = JSON.parse(init.body as string); writes.push({ path, body });
    const request = data.requests[0];
    if (path === '/api/duty-ops/swaps') {
      data = { ...data, lockedShiftIds: [own.id], requests: [makeRequest({ type: body.type, requester: { id: 'me', firstName: 'Simon', lastName: null }, requestedShift: own })] };
    } else if (path.endsWith('/claim')) { request.status = 'ACCEPTED'; request.acceptedBy = { id: 'me', firstName: 'Simon', lastName: null }; }
    else if (path.endsWith('/accept')) { request.status = 'ACCEPTED'; request.acceptedBy = anna; request.acceptedProposalId = 'proposal'; request.proposals.forEach(p => { p.status = p.id === 'proposal' ? 'ACCEPTED' : 'NOT_SELECTED'; }); }
    else if (path.endsWith('/cancel')) { request.status = 'CANCELLED'; data.lockedShiftIds = []; }
    else if (path.endsWith('/withdraw')) { request.proposals[0].status = 'WITHDRAWN'; data.lockedShiftIds = []; }
    return Response.json({ id: 'request' });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(shifts = [own]) {
  await act(async () => root.render(<MemoryRouter><DutyExchanges now={now} shifts={shifts} refreshKey={0}>
    <ShiftList shifts={shifts} showDate renderAction={shift => <ExchangeShiftActions shift={shift} />} />
  </DutyExchanges></MemoryRouter>));
}
async function click(text: string, container: ParentNode = host) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text);
  expect(button, `button ${text}`).toBeDefined(); expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}
function dialog() { return host.querySelector<HTMLDialogElement>('dialog')!; }
describe('Duty Ops shift exchange UI', () => {
  it.each([-2, -3])('hides give-away at balance %s and keeps direct swaps usable', async balance => {
    data.currentUserCreditBalance = balance; await render(); await click('Exchange');
    expect(dialog().textContent).not.toContain('Give away');
    await click('Post my assignment for swap', dialog()); await click('Publish request', dialog());
    expect(writes[0].body.type).toBe('DIRECT_SWAP');
  });
  it.each([0, -1, 2])('explains the predicted debit from balance %s', async balance => {
    data.currentUserCreditBalance = balance; await render(); await click('Exchange'); await click('Give away', dialog());
    const sign = (n: number) => n > 0 ? `+${n}` : String(n);
    expect(dialog().textContent).toContain(`Your current balance: ${sign(balance)} · After this shift is taken: ${sign(balance - 1)}`);
  });
  it('allows earning at the floor and explains the predicted credit', async () => {
    data.currentUserCreditBalance = -2; data.requests = [makeRequest()]; await render(); await click('Take shift');
    expect(dialog().textContent).toContain('-2 → -1'); await click('Take shift', dialog()); expect(writes).toHaveLength(1);
  });
  it('explains a blocked owner request without revealing an exact counterparty balance', async () => {
    data.requests = [makeRequest({ requester: { id: 'me', firstName: null, lastName: null }, eligible: false, ineligibleReason: 'CREDIT_FLOOR' })];
    await render(); expect(host.textContent).toContain('Your balance must be above -2');
    expect(host.textContent).toContain('Currently unavailable'); await click('Cancel request'); await click('Cancel request', dialog());
  });
  it('refreshes the overview balance after another student claims a shift', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const changed = vi.fn();
    await act(async () => root.render(<MemoryRouter><DutyExchanges shifts={[own]} now={now} refreshKey={0} onBalanceChanged={changed}>Overview</DutyExchanges></MemoryRouter>));
    expect(changed).toHaveBeenLastCalledWith(0);
    data = { ...data, currentUserCreditBalance: -1 };
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(changed).toHaveBeenLastCalledWith(-1);
  });
  it('has no controls or exchange fetch without swap permission', async () => {
    permissions = ['duty_ops.view']; await render();
    expect(host.textContent).not.toContain('Exchange');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('only offers exchange controls on owned, open future shifts', async () => {
    await render([own, { ...own, id: 'cancelled', status: 'CANCELLED' }, { ...own, id: 'completed', status: 'COMPLETED' },
      { ...own, id: 'past', startsAt: '2026-09-26T05:00:00.000Z', endsAt: '2026-09-26T10:00:00.000Z' },
      { ...own, id: 'other', participants: [] }]);
    expect([...host.querySelectorAll('button')].filter(b => b.textContent === 'Exchange')).toHaveLength(1);
  });
  it.each(['GIVE_AWAY', 'DIRECT_SWAP'] as const)('publishes %s with the displayed dates and reserves the shift', async type => {
    await render(); await click('Exchange');
    expect(dialog().textContent).toContain('Give away'); expect(dialog().textContent).toContain('Available exchanges');
    await click(type === 'GIVE_AWAY' ? 'Give away' : 'Post my assignment for swap', dialog());
    if (type === 'GIVE_AWAY') expect(dialog().textContent).toContain('without further confirmation');
    await click('Publish request', dialog());
    expect(writes).toEqual([{ path: '/api/duty-ops/swaps', body: { type, shiftId: own.id, startsAt: own.startsAt, endsAt: own.endsAt } }]);
    expect(host.querySelector('dialog')).toBeNull(); expect(host.textContent).toContain(type === 'GIVE_AWAY' ? 'Give-away posted' : 'Looking for swap');
  });
  it('takes a give-away with one claimant confirmation and no original-owner confirmation', async () => {
    data.requests = [makeRequest()]; await render(); await click('Take shift');
    expect(dialog().textContent).toContain('Take this Duty Ops shift?'); await click('Take shift', dialog());
    expect(writes).toHaveLength(1); expect(writes[0].path).toBe('/api/duty-ops/swaps/request/claim');
    expect(host.textContent).not.toContain('Take shift'); expect(host.textContent).not.toContain('Exchange agreed');
    expect(host.textContent).not.toContain('Confirm owner');
  });
  it('shows multiple offers and confirms both shifts before choosing one', async () => {
    data.requests = [makeRequest({ type: 'DIRECT_SWAP', requester: { id: 'me', firstName: 'Simon', lastName: null }, requestedShift: own,
      proposals: [makeProposal(), makeProposal({ id: 'second', proposer: erik })] })]; data.lockedShiftIds = ['own'];
    await render();
    expect([...host.querySelectorAll('button')].filter(b => b.textContent === 'Choose this swap')).toHaveLength(2);
    await click('Choose this swap');
    expect(dialog().textContent).toContain('Your shift'); expect(dialog().textContent).toContain('Mon 28 Sept · 07:00–12:00');
    expect(dialog().textContent).toContain('Anna Student’s shift'); expect(dialog().textContent).toContain('Tue 29 Sept · 12:00–18:00');
    expect(writes).toHaveLength(0); await click('Confirm exchange', dialog());
    expect(writes[0].path).toBe('/api/duty-ops/swaps/request/proposals/proposal/accept');
    expect(host.textContent).not.toContain('Not selected'); expect(host.textContent).not.toContain('Exchange agreed');
    expect([...host.querySelectorAll('button')].some(b => /Choose this swap|Cancel request|Withdraw offer/.test(b.textContent!))).toBe(false);
    // This isolated component cannot replace its parent's read model; the page reloads it.
    expect(host.querySelector('.duty-row .duty-participants')!.textContent).toMatch(/^You/);
    expect(host.querySelector('.duty-row .people-code.is-you')!.textContent).toBe('SST');
  });
  it('offers only eligible owned unreserved shifts', async () => {
    data.requests = [makeRequest({ type: 'DIRECT_SWAP' })]; await render([own, { ...own, id: 'cancelled', status: 'CANCELLED' }, { ...own, id: 'someone-else', participants: [] }]);
    await click('Offer one of my shifts');
    const select = dialog().querySelector<HTMLSelectElement>('select')!;
    expect([...select.options].map(o => o.value)).toEqual(['', 'own']);
    await act(async () => { select.value = 'own'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('Offer shift', dialog());
    expect(writes[0]).toEqual({ path: '/api/duty-ops/swaps/request/proposals', body: { shiftId: 'own', startsAt: own.startsAt, endsAt: own.endsAt } });
  });
  it('confirms owner cancellation and releases controls afterward', async () => {
    data.requests = [makeRequest({ requester: { id: 'me', firstName: null, lastName: null }, requestedShift: own })]; data.lockedShiftIds = ['own'];
    await render(); await click('Cancel request'); expect(writes).toHaveLength(0);
    await click('Cancel request', dialog()); expect(host.textContent).not.toContain('Cancelled');
    expect(host.textContent).toContain('Exchange');
  });
  it('permits only the current proposer to withdraw open offers', async () => {
    data.requests = [makeRequest({ type: 'DIRECT_SWAP', proposals: [makeProposal({ proposer: { id: 'me', firstName: 'Simon', lastName: null }, offeredShift: own })] })];
    data.lockedShiftIds = ['own']; await render(); await click('Withdraw offer'); await click('Withdraw offer', dialog());
    expect(writes[0].path).toBe('/api/duty-ops/swaps/request/proposals/proposal/withdraw');
    expect(host.textContent).not.toContain('Withdrawn');
  });
  it('keeps an own swap request, its offers and cancel action on the assignment', async () => {
    data.requests = [makeRequest({ type: 'DIRECT_SWAP', requester: { id: 'me', firstName: 'Simon', lastName: null }, requestedShift: own,
      proposals: [makeProposal(), makeProposal({ id: 'second', proposer: erik })] })]; data.lockedShiftIds = ['own'];
    await render();
    const row = host.querySelector('.duty-row')!;
    expect(row.textContent).toContain('Looking for swap · 2 offers');
    expect(row.querySelector('button')?.textContent).toBe('Cancel');
    expect(row.querySelector('a[href^="/duty-ops/exchanges#"]')?.textContent).toBe('Review offers');
    expect(row.textContent).not.toContain('Exchange active');
  });
  it('keeps a posted give-away cancellable on its assignment', async () => {
    data.requests = [makeRequest({ requester: { id: 'me', firstName: 'Simon', lastName: null }, requestedShift: own })]; data.lockedShiftIds = ['own'];
    await render();
    const row = host.querySelector('.duty-row')!;
    expect(row.textContent).toContain('Give-away posted');
    await click('Cancel', row); await click('Cancel request', dialog());
    expect(writes[0].path).toBe('/api/duty-ops/swaps/request/cancel');
    expect(row.textContent).toContain('Exchange');
  });
  it('shows sent offers on the owned shift and never offers the same request twice', async () => {
    data.requests = [makeRequest({ type: 'DIRECT_SWAP', proposals: [makeProposal({ proposer: { id: 'me', firstName: 'Simon', lastName: null }, offeredShift: own })] })];
    data.lockedShiftIds = ['own']; await render();
    const row = host.querySelector('.duty-row')!;
    expect(row.textContent).toContain('Offer sent');
    expect(row.textContent).toContain('Withdraw offer');
    expect(host.querySelector('.exchange-row')?.textContent).not.toContain('Offer one of my shifts');
    await click('Withdraw offer', row); await click('Withdraw offer', dialog());
    expect(writes[0].path).toContain('/withdraw');
  });
  it('shows valid browse actions on another shift and preselects the chosen own shift', async () => {
    const other = { ...own, id: 'other', startsAt: offered.startsAt, endsAt: offered.endsAt, participants: [] };
    data.requests = [makeRequest({ type: 'DIRECT_SWAP', requestedShift: offered })];
    await render([own, other]);
    const ownRow = host.querySelectorAll('.duty-row')[0];
    await click('Exchange', ownRow);
    expect(dialog().textContent).toContain('Anna Student wants to swap');
    expect(writes).toHaveLength(0);
    await click('Offer your assignment', dialog());
    expect(dialog().querySelector<HTMLSelectElement>('select')?.value).toBe('own');
    await click('Offer shift', dialog());
    expect(writes[0]).toEqual({ path: '/api/duty-ops/swaps/request/proposals', body: { shiftId: 'own', startsAt: own.startsAt, endsAt: own.endsAt } });
  });
  it('shows a give-away in the schedule but hides claiming when eligibility is false', async () => {
    const other = { ...own, id: 'anna-shift', startsAt: offered.startsAt, endsAt: offered.endsAt, participants: [] };
    data.requests = [makeRequest({ eligible: false })];
    await render([own, other]);
    const row = host.querySelectorAll('.duty-row')[1];
    expect(row.textContent).toContain('Give-away');
    expect(row.textContent).not.toContain('Take shift');
    expect(host.querySelector('.exchange-row')).toBeNull();
  });
  it('keeps stale/conflicting acceptance errors visible without claiming success', async () => {
    data.requests = [makeRequest()]; await render();
    fetcher.mockImplementation(async (_path: string, init: RequestInit) => init.method === 'POST' ? Response.json({ error: 'This exchange changed. Reload Duty Ops.' }, { status: 409 }) : Response.json(data));
    await click('Take shift'); await click('Take shift', dialog());
    expect(dialog().querySelector('[role=alert]')!.textContent).toContain('Reload Duty Ops');
    expect(host.textContent).not.toContain('Exchange agreed');
  });
});

describe('exchange API client', () => {
  it('uses same-origin relative URLs and never caches mutation responses', async () => {
    data.requests = [makeRequest()];
    await loadExchanges(new AbortController().signal); await saveExchange('/request/cancel');
    expect(fetcher.mock.calls[0][0]).toBe('/api/duty-ops/swaps');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'POST', body: '{}' });
  });
  it('distinguishes portal permission denial and malformed responses', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ code: 'FORBIDDEN' }, { status: 403 })).mockResolvedValueOnce(Response.json({}));
    await expect(saveExchange('')).rejects.toThrow('permission');
    await expect(loadExchanges(new AbortController().signal)).rejects.toThrow('unexpected');
  });
});
