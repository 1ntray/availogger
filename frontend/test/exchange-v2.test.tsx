// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentActionState, ExchangeAssignmentSnapshot, ExchangeDomain, ExchangeV2StateResponse } from '../../shared/exchange-v2';
import { ExchangeV2AssignmentAction, ExchangeV2Provider, ExchangeV2Summary } from '../src/features/exchange/ExchangeV2';
import { LegacyOpportunityProvider } from '../src/features/exchange/legacy-preview';
import { compactSwapperNames } from '../src/features/exchange/presentation';

const permissions = ['duty_ops.swap', 'flyvask.swap', 'brakkevakt.swap'];
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { permissions } }) }));
const at = (id: string, day: number): ExchangeAssignmentSnapshot => ({ id,
  startsAt: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`, endsAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
  status: 'OPEN', version: 'v1' });
const a = at('a', 2), b = at('b', 4), c = at('c', 5), d = at('d', 6);
const descriptors = [a, b, c, d].map((item, index) => ({ id: item.id, label: `Shift ${item.id}`,
  ownerNames: index === 0 ? 'You' : 'Anna', own: index === 0 }));
const state = (id: string, relationship: AssignmentActionState['relationship'], actions: AssignmentActionState['availableActions'],
  overrides: Partial<AssignmentActionState> = {}): AssignmentActionState => ({ assignmentId: id, relationship, availableActions: actions,
  relatedIntentIds: [], relatedCandidateIds: [], requestableSourceAssignmentIds: [], requestableSourceAssignments: [],
  offerableIntentIds: [], ...overrides });
const own = () => state('a', 'OWN_IDLE', ['OPEN_EXCHANGE']);
const target = (id: string) => state(id, 'NONE', ['REQUEST_SWAP'], { requestableSourceAssignmentIds: ['a'], requestableSourceAssignments: [a] });
const empty = (domain: ExchangeDomain): ExchangeV2StateResponse => ({ domain, currentUserId: 'me', timeZone: 'Europe/Oslo',
  intents: [], candidates: [], assignmentStates: [own(), target('b'), target('c'), target('d')] });
function opportunities() {
  response.intents = [b, c, d].map(item => ({ id: `intent-${item.id}`, status: 'OPEN', reason: null,
    owner: { id: 'anna', firstName: 'Anna', lastName: null }, source: item, allowGiveAway: false,
    createdAt: item.startsAt, targets: [], offers: [] }));
}
let root: Root, host: HTMLDivElement, response: ExchangeV2StateResponse, fetcher: ReturnType<typeof vi.fn>;
let afterPost: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  response = empty('DUTY_OPS'); afterPost = undefined;
  fetcher = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path.startsWith('/api/exchanges/v2/intents?')) return Response.json(response);
    if (path === '/api/duty-ops/credits?summary=1') return Response.json({ balance: 0, coveredCount: 0, receivedCount: 0 });
    if (init.method === 'POST') { afterPost?.(); return Response.json({ id: 'new' }); }
    throw new Error(`Unexpected endpoint ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(domain: ExchangeDomain = 'DUTY_OPS', center = false) {
  response.domain = domain;
  await act(async () => root.render(<MemoryRouter><ExchangeV2Provider domain={domain} assignments={descriptors}
    refreshKey={0} onChanged={vi.fn()}>
    {descriptors.map(item => <div key={item.id} data-assignment={item.id}><ExchangeV2AssignmentAction assignmentId={item.id} /></div>)}
    <ExchangeV2Summary domain={domain} center={center} /><section id="exchange-schedule">Schedule</section>
  </ExchangeV2Provider></MemoryRouter>));
}
async function click(label: string, scope: ParentNode = host.querySelector('dialog') ?? host) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label);
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}
function posted() { return fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); }

describe('Exchange v2 assignment actions', () => {
  it('formats one, two and several actual swapper names compactly', () => {
    expect(compactSwapperNames(['Håvard Olsen'])).toBe('Håvard');
    expect(compactSwapperNames(['Håvard Olsen', 'Lisa Hansen'])).toBe('Håvard and Lisa');
    expect(compactSwapperNames(['Håvard Olsen', 'Lisa Hansen', 'Gustav', 'Nora'])).toBe('Håvard, Lisa +2');
  });
  it('keeps prior actions during refresh and after a failed refresh', async () => {
    await render();
    expect(host.querySelector('[data-assignment="a"]')?.textContent).toContain('Exchange');
    let rejectRefresh: (error: Error) => void = () => {};
    fetcher.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    await act(async () => root.render(<MemoryRouter><ExchangeV2Provider domain="DUTY_OPS" assignments={descriptors} refreshKey={1}
      onChanged={vi.fn()}><ExchangeV2AssignmentAction assignmentId="a" /><ExchangeV2Summary domain="DUTY_OPS" /></ExchangeV2Provider></MemoryRouter>));
    expect(host.textContent).toContain('Exchange');
    await act(async () => rejectRefresh(new Error('Offline')));
    expect(host.textContent).toContain('Exchange refresh failed');
    expect(host.querySelector('button')?.textContent).toBe('Exchange');
  });
  it('reserves action space before its first authoritative load', async () => {
    fetcher.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => root.render(<MemoryRouter><ExchangeV2Provider domain="DUTY_OPS" assignments={descriptors} refreshKey={0}
      onChanged={vi.fn()}><ExchangeV2AssignmentAction assignmentId="a" /></ExchangeV2Provider></MemoryRouter>));
    expect(host.querySelector('.exchange-action-placeholder')?.textContent).toBe('Loading options…');
    expect(host.querySelector('button')).toBeNull();
  });
  it('shows a bounded unified preview with actionable legacy work', async () => {
    opportunities();
    response.assignmentStates[0] = state('a', 'OWN_IDLE', ['OFFER_SHIFT'], { offerableIntentIds: ['intent-b', 'intent-c', 'intent-d'] });
    response.assignmentStates[1] = state('b', 'SWAP_AVAILABLE', ['REQUEST_SWAP'], { relatedIntentIds: ['intent-b'] });
    response.assignmentStates[2] = state('c', 'SWAP_AVAILABLE', ['REQUEST_SWAP'], { relatedIntentIds: ['intent-c'] });
    response.assignmentStates[3] = state('d', 'SWAP_AVAILABLE', ['REQUEST_SWAP'], { relatedIntentIds: ['intent-d'] });
    await act(async () => root.render(<MemoryRouter><ExchangeV2Provider domain="DUTY_OPS" assignments={descriptors} refreshKey={0}
      onChanged={vi.fn()}><LegacyOpportunityProvider items={[{ id: 'old', label: 'Fri 9 Oct · 10:00–12:00', description: 'Swap wanted by Lisa', action: <button>Offer a shift</button> },
        { id: 'old-2', label: 'Sat 10 Oct · 10:00–12:00', description: 'Your exchange', action: <button>Open exchange</button> }]}>
      <ExchangeV2Summary domain="DUTY_OPS" /></LegacyOpportunityProvider></ExchangeV2Provider></MemoryRouter>));
    expect(host.querySelectorAll('.exchange-preview-list > li')).toHaveLength(4);
    expect(host.querySelector('.exchange-preview-list')?.textContent).toContain('Swap wanted by Lisa');
    expect(host.querySelector('.exchange-preview-more')?.textContent).toContain('1 more exchange');
    expect(host.querySelectorAll('h2')).toHaveLength(1);
    expect(host.querySelector('.exchange-preview-list button')?.textContent).toBe('Offer a shift');
  });
  it('keeps swap and give-away as distinct canonical Duty Ops choices', async () => {
    response.intents = [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'anna', firstName: 'Anna', lastName: null },
      source: b, allowGiveAway: true, createdAt: a.startsAt, targets: [], offers: [] }];
    response.assignmentStates[0] = state('a', 'OWN_IDLE', ['OFFER_SHIFT'], { offerableIntentIds: ['intent'] });
    response.assignmentStates[1] = state('b', 'GIVE_AWAY_AVAILABLE', ['TAKE_GIVE_AWAY', 'REQUEST_SWAP'], { relatedIntentIds: ['intent'] });
    await render();
    const row = host.querySelector('[data-assignment="b"]')!;
    expect([...row.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Offer a shift', 'Take shift · +1 credit']);
    expect(row.textContent).toContain('Anna is open to swap or give-away');
  });
  it('shows only the credit action when only a give-away is available', async () => {
    response.intents = [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'anna', firstName: 'Anna', lastName: null },
      source: b, allowGiveAway: true, createdAt: a.startsAt, targets: [], offers: [] }];
    response.assignmentStates[1] = state('b', 'GIVE_AWAY_AVAILABLE', ['TAKE_GIVE_AWAY'], { relatedIntentIds: ['intent'] });
    await render();
    const row = host.querySelector('[data-assignment="b"]')!;
    expect(row.textContent).toContain('Give-away available from Anna');
    expect([...row.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Take shift · +1 credit']);
  });
  it.each([{ selected: [] }, { selected: ['b'] }, { selected: ['b', 'c'] }])('creates one implicit open intent with targets $selected', async ({ selected }) => {
    opportunities();
    await render(); await click('Exchange', host.querySelector('[data-assignment="a"]')!);
    expect(host.querySelector('dialog')!.textContent).toContain('Available exchanges');
    expect(host.querySelector('dialog')!.textContent).not.toContain('Open to other offers');
    for (const id of selected) {
      const box = [...host.querySelectorAll<HTMLInputElement>('.exchange-v2-choices input')].find(input => input.closest('label')?.textContent?.includes(`Shift ${id}`))!;
      await act(async () => box.click());
    }
    await click('Post exchange');
    expect(posted()).toHaveLength(1);
    expect(JSON.parse(posted()[0][1].body)).toEqual({ domain: 'DUTY_OPS', sourceAssignmentId: 'a', targetAssignmentIds: selected, allowGiveAway: false });
  });
  it('combines multiple targets with Duty Ops give-away in the same intent', async () => {
    opportunities();
    await render(); await click('Exchange', host.querySelector('[data-assignment="a"]')!);
    for (const box of host.querySelectorAll<HTMLInputElement>('.exchange-v2-choices input')) await act(async () => box.click());
    await act(async () => host.querySelector<HTMLInputElement>('.exchange-v2-give input')!.click());
    expect(host.querySelector('.exchange-v2-give')!.textContent).toContain('After give-away: -1');
    await click('Post exchange');
    expect(JSON.parse(posted()[0][1].body)).toMatchObject({ targetAssignmentIds: ['b', 'c', 'd'], allowGiveAway: true });
  });
  it.each(['FLYVASK', 'BRAKKEVAKT'] as const)('%s has the same intent flow without give-away', async domain => {
    await render(domain); await click('Exchange', host.querySelector('[data-assignment="a"]')!);
    expect(host.querySelector('.exchange-v2-give')).toBeNull();
    await click('Post exchange');
    expect(JSON.parse(posted()[0][1].body)).toMatchObject({ domain, allowGiveAway: false });
  });
  it('requests an ordinary target and refreshes the row to Request sent', async () => {
    afterPost = () => { response.assignmentStates = [own(), state('b', 'REQUEST_SENT', [], { relatedIntentIds: ['new'] })]; };
    await render(); expect(host.querySelector('[data-assignment="b"]')!.textContent).toContain('Request swap');
    await click('Request swap', host.querySelector('[data-assignment="b"]')!);
    expect(host.querySelector('dialog')!.textContent).toContain('You want');
    expect(host.querySelectorAll('dialog input[type="radio"]')).toHaveLength(1);
    await click('Send request');
    expect(JSON.parse(posted()[0][1].body)).toMatchObject({ sourceAssignmentId: 'a', targetAssignmentIds: ['b'] });
    expect(host.querySelector('[data-assignment="b"]')!.textContent).toContain('Request sent');
    expect(host.querySelector('[data-assignment="b"]')!.textContent).not.toContain('Request swap');
  });
  it('lets the user choose among server-approved source assignments', async () => {
    response.assignmentStates[1] = state('b', 'NONE', ['REQUEST_SWAP'], { requestableSourceAssignmentIds: ['a', 'd'], requestableSourceAssignments: [a, d] });
    await render(); await click('Request swap', host.querySelector('[data-assignment="b"]')!);
    expect(host.querySelectorAll('dialog input[type="radio"]')).toHaveLength(2);
    const second = host.querySelectorAll<HTMLInputElement>('dialog input[type="radio"]')[1];
    await act(async () => second.click()); await click('Send request');
    expect(JSON.parse(posted()[0][1].body).sourceAssignmentId).toBe('d');
  });
  it('selects a target in the normal schedule and keeps that selection in the dialog', async () => {
    await render(); await click('Exchange', host.querySelector('[data-assignment="a"]')!);
    await click('Browse schedule');
    expect(host.querySelector('dialog')).toBeNull();
    const box = host.querySelector<HTMLInputElement>('[data-assignment="b"] input[type="checkbox"]')!;
    await act(async () => box.click());
    expect(box.checked).toBe(true);
    await click('Done', host.querySelector('.exchange-browse-bar')!);
    expect(host.querySelector('dialog')!.textContent).toContain('Selected from schedule');
    expect(host.querySelector('dialog')!.textContent).toContain('Shift b');
    await click('Post exchange');
    expect(JSON.parse(posted()[0][1].body).targetAssignmentIds).toEqual(['b']);
  });
  it('shows no action for an expired assignment even when present in schedule', async () => {
    response.assignmentStates[1] = state('b', 'NONE', []);
    await render(); expect(host.querySelector('[data-assignment="b"]')!.textContent).toBe('');
  });
  it('shows a received targeted request and its exact result before acceptance', async () => {
    response.intents = [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'anna', firstName: 'Anna', lastName: null },
      source: b, allowGiveAway: false, createdAt: a.startsAt, targets: [{ id: 'target', status: 'OPEN', reason: null, assignment: a }], offers: [] }];
    response.assignmentStates[0] = state('a', 'INCOMING_REQUEST', ['ACCEPT_TARGET'], { relatedIntentIds: ['intent'] });
    await render(); expect(host.querySelector('[data-assignment="a"]')!.textContent).toContain('Request received');
    await click('Review request');
    expect(host.querySelector('dialog')!.textContent).toContain('You give');
    expect(host.querySelector('dialog')!.textContent).toContain('You receive');
    await click('Accept request');
    expect(posted()[0][0]).toBe('/api/exchanges/v2/targets/target/accept');
  });
  it('shows an own offer and permits withdrawal only through canonical state', async () => {
    response.intents = [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'anna', firstName: 'Anna', lastName: null },
      source: b, allowGiveAway: false, createdAt: a.startsAt, targets: [], offers: [{ id: 'offer', status: 'OPEN', reason: null,
        offerer: { id: 'me', firstName: 'You', lastName: null }, assignment: a }] }];
    response.assignmentStates[0] = state('a', 'OFFER_SENT', ['WITHDRAW_OFFER'], { relatedIntentIds: ['intent'] });
    await render(); expect(host.querySelector('[data-assignment="a"]')!.textContent).toContain('Offer sent');
    await click('Withdraw', host.querySelector('[data-assignment="a"]')!); await click('Withdraw offer');
    expect(posted()[0][0]).toBe('/api/exchanges/v2/offers/offer/withdraw');
  });
  it('offers a server-approved own assignment from an open exchange schedule row', async () => {
    response.intents = [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'anna', firstName: 'Anna', lastName: null },
      source: b, allowGiveAway: false, createdAt: a.startsAt, targets: [], offers: [] }];
    response.assignmentStates[0] = state('a', 'OWN_IDLE', ['OPEN_EXCHANGE', 'OFFER_SHIFT'], { offerableIntentIds: ['intent'] });
    response.assignmentStates[1] = state('b', 'SWAP_AVAILABLE', ['REQUEST_SWAP'], { relatedIntentIds: ['intent'],
      requestableSourceAssignmentIds: ['a'], requestableSourceAssignments: [a] });
    response.assignmentStates[3] = state('d', 'OWN_IDLE', ['OFFER_SHIFT'], { offerableIntentIds: ['intent'] });
    await render();
    expect(host.querySelector('[data-assignment="b"]')!.textContent).toContain('Swap wanted');
    expect(host.querySelector('[data-assignment="b"]')!.textContent).toContain('Offer a shift');
    await click('Offer a shift', host.querySelector('[data-assignment="b"]')!);
    expect(host.querySelectorAll('dialog input[type="radio"]')).toHaveLength(2);
    await act(async () => host.querySelectorAll<HTMLInputElement>('dialog input[type="radio"]')[1].click());
    await click('Offer assignment');
    expect(posted()[0][0]).toBe('/api/exchanges/v2/intents/intent/offers');
    expect(JSON.parse(posted()[0][1].body)).toEqual({ assignmentId: 'd' });
  });
  it('presents a three-way exact outcome only to the student who still needs consent', async () => {
    const person = (id: string) => ({ id, firstName: id, lastName: null });
    response.candidates = [{ id: 'candidate', intentId: 'intent', status: 'WAITING', reason: null, targetId: null, offerId: null,
      createdAt: a.startsAt, completedAt: null, legs: [
        { user: person('me'), give: a, receive: b, consentSource: null, consentedAt: null },
        { user: person('anna'), give: b, receive: c, consentSource: 'TARGET', consentedAt: a.startsAt },
        { user: person('carl'), give: c, receive: a, consentSource: 'TARGET', consentedAt: a.startsAt },
      ] }];
    response.assignmentStates[0] = state('a', 'CANDIDATE_REVIEW_REQUIRED', ['CONFIRM_CANDIDATE', 'DECLINE_CANDIDATE'],
      { relatedCandidateIds: ['candidate'] });
    await render('DUTY_OPS', true);
    expect(host.querySelector('.exchange-v2-center')!.textContent).toContain('3-way exchange');
    await click('Review exchange', host.querySelector('[data-assignment="a"]')!);
    expect(host.querySelector('dialog')!.textContent).toContain('2 other students');
    expect(host.querySelector('dialog')!.textContent).toContain('You give');
    expect(host.querySelector('dialog')!.textContent).toContain('You receive');
    await click('Accept exchange');
    expect(posted()[0][0]).toBe('/api/exchanges/v2/candidates/candidate/confirm');
  });
  it('shows an own open intent and a waiting candidate without duplicate approval', async () => {
    response.intents = [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'me', firstName: 'You', lastName: null },
      source: a, allowGiveAway: true, createdAt: a.startsAt, targets: [], offers: [] }];
    response.assignmentStates[0] = state('a', 'OWN_EXCHANGE_OPEN', ['CANCEL_INTENT'], { relatedIntentIds: ['intent'] });
    await render(); expect(host.querySelector('[data-assignment="a"]')!.textContent).toContain('Looking for exchange');
    expect(host.querySelector('[data-assignment="a"]')!.textContent).toContain('Give-away enabled');
    expect(host.querySelector('[data-assignment="a"]')!.textContent).toContain('Open exchange');
    response.candidates = [{ id: 'candidate', intentId: 'intent', status: 'WAITING', reason: null, targetId: null, offerId: null,
      createdAt: a.startsAt, completedAt: null, legs: [{ user: { id: 'me', firstName: 'You', lastName: null }, give: a, receive: b,
        consentSource: 'TARGET', consentedAt: a.startsAt }] }];
    response.assignmentStates[0] = state('a', 'CANDIDATE_WAITING', [], { relatedCandidateIds: ['candidate'] });
    await act(async () => root.render(<MemoryRouter><ExchangeV2Provider domain="DUTY_OPS" assignments={descriptors} refreshKey={1}
      onChanged={vi.fn()}><ExchangeV2AssignmentAction assignmentId="a" /><ExchangeV2Summary domain="DUTY_OPS" center /></ExchangeV2Provider></MemoryRouter>));
    expect(host.textContent).toContain('Waiting for others'); expect(host.textContent).not.toContain('Accept exchange');
  });
});
