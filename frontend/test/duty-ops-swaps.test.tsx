// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  requestedShift: offered, acceptedBy: null, acceptedProposalId: null, createdAt: '2026-09-27T07:00:00.000Z', acceptedAt: null, proposals: [], eligible: true, ...changes });
const makeProposal = (changes: Partial<ExchangeProposal> = {}): ExchangeProposal => ({ id: 'proposal', proposer: anna, offeredShift: offered, status: 'OPEN', createdAt: '2026-09-27T07:00:00.000Z', eligible: true, ...changes });
let data: ExchangesResponse, host: HTMLDivElement, root: Root;
let writes: { path: string; body: Record<string, unknown> }[];
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  permissions = ['duty_ops.view', 'duty_ops.swap'];
  data = { currentUserId: 'me', requests: [], lockedShiftIds: [], nextCursor: null }; writes = [];
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(shifts = [own]) {
  await act(async () => root.render(<DutyExchanges now={now} shifts={shifts} refreshKey={0}>
    <ShiftList shifts={shifts} showDate renderAction={shift => <ExchangeShiftActions shift={shift} />} />
  </DutyExchanges>));
}
async function click(text: string, container: ParentNode = host) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text);
  expect(button, `button ${text}`).toBeDefined(); expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}
function dialog() { return host.querySelector<HTMLDialogElement>('dialog')!; }
async function selectType(type: 'GIVE_AWAY' | 'DIRECT_SWAP') {
  await act(async () => dialog().querySelectorAll<HTMLInputElement>('input')[type === 'GIVE_AWAY' ? 0 : 1].click());
}

describe('Duty Ops shift exchange UI', () => {
  it('has no controls or exchange fetch without swap permission', async () => {
    permissions = ['duty_ops.view']; await render();
    expect(host.textContent).not.toContain('Exchange shift'); expect(host.textContent).not.toContain('Shift exchange');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('only offers exchange controls on owned, open future shifts', async () => {
    await render([own, { ...own, id: 'cancelled', status: 'CANCELLED' }, { ...own, id: 'completed', status: 'COMPLETED' },
      { ...own, id: 'past', startsAt: '2026-09-26T05:00:00.000Z', endsAt: '2026-09-26T10:00:00.000Z' },
      { ...own, id: 'other', participants: [] }]);
    expect([...host.querySelectorAll('button')].filter(b => b.textContent === 'Exchange shift')).toHaveLength(1);
  });
  it.each(['GIVE_AWAY', 'DIRECT_SWAP'] as const)('publishes %s with the displayed dates and reserves the shift', async type => {
    await render(); await click('Exchange shift');
    expect(dialog().textContent).toContain('Give away'); expect(dialog().textContent).toContain('Look for swap');
    await selectType(type);
    if (type === 'GIVE_AWAY') expect(dialog().textContent).toContain('without another confirmation');
    await click('Publish request', dialog());
    expect(writes).toEqual([{ path: '/api/duty-ops/swaps', body: { type, shiftId: own.id, startsAt: own.startsAt, endsAt: own.endsAt } }]);
    expect(host.querySelector('dialog')).toBeNull(); expect(host.textContent).toContain('Shift has an active exchange');
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
    expect(host.querySelector('.duty-row')!.textContent).toContain('Simon Student');
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
    expect(host.textContent).toContain('Exchange shift');
  });
  it('permits only the current proposer to withdraw open offers', async () => {
    data.requests = [makeRequest({ type: 'DIRECT_SWAP', proposals: [makeProposal({ proposer: { id: 'me', firstName: 'Simon', lastName: null }, offeredShift: own })] })];
    data.lockedShiftIds = ['own']; await render(); await click('Withdraw offer'); await click('Withdraw offer', dialog());
    expect(writes[0].path).toBe('/api/duty-ops/swaps/request/proposals/proposal/withdraw');
    expect(host.textContent).not.toContain('Withdrawn');
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
