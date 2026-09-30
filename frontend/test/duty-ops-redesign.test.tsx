// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyOpsPage } from '../src/pages/DutyOpsPage';
import { PeopleStack } from '../src/app/ui';
import { dayHeading, endsInLabel, shiftProgress } from '../src/features/duty-ops/DutyCards';
import type { DutyOpsData, DutyShift } from '../src/features/duty-ops/types';

const account = vi.hoisted(() => ({ permissions: ['duty_ops.view', 'duty_ops.swap'] as string[], refresh: async () => {} }));
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { subject: 'me', permissions: account.permissions }, refresh: account.refresh }) }));

const now = Date.parse('2026-09-30T14:17:00Z'); // Wed 30 Sep, 16:17 Oslo
const me = { userId: 'me', firstName: 'Ole Markus', lastName: 'Rockstad', isCurrentUser: true };
const anna = { userId: 'anna', firstName: 'Anna', lastName: 'Berg', isCurrentUser: false };
const shift = (id: string, startsAt: string, endsAt: string, participants: DutyShift['participants'] = []): DutyShift =>
  ({ id, startsAt, endsAt, status: 'OPEN', participantCount: 3, participants });
const onNow = shift('now', '2026-09-30T11:00:00Z', '2026-09-30T15:00:00Z', [anna]);
const mine = shift('mine', '2026-10-01T06:00:00Z', '2026-10-01T11:00:00Z', [me, anna]);
const friday = shift('fri', '2026-10-02T14:00:00Z', '2026-10-02T18:00:00Z');
const metadata = { lastSyncedAt: '2026-09-30T14:17:00Z', from: '2026-09-30T00:00:00Z', to: '2026-11-28T00:00:00Z', stale: false };
const data: DutyOpsData = { from: '2026-09-30', to: '2026-11-28', timeZone: 'Europe/Oslo', shifts: [onNow, mine, friday], sync: { stale: false, warning: null, discovery: metadata, assignments: metadata } };
const snapshot = (item: DutyShift) => ({ id: item.id, startsAt: item.startsAt, endsAt: item.endsAt, status: 'OPEN', version: '1' });
const state = (item: DutyShift, extra: object = {}) => ({ assignmentId: item.id, relationship: item.participants.some(p => p.isCurrentUser) ? 'OWN_IDLE' : 'NONE',
  availableActions: [], relatedIntentIds: [], relatedCandidateIds: [], requestableSourceAssignmentIds: [], requestableSourceAssignments: [], offerableIntentIds: [], ...extra });
const v2 = ({ review = false, available = false } = {}) => ({
  domain: 'DUTY_OPS', currentUserId: 'me', timeZone: 'Europe/Oslo',
  intents: available ? [{ id: 'intent', status: 'OPEN', reason: null, owner: { id: 'anna', firstName: 'Anna', lastName: 'Berg' }, source: snapshot(friday), allowGiveAway: false, createdAt: metadata.lastSyncedAt, targets: [], offers: [] }] : [],
  candidates: review ? [{ id: 'candidate', intentId: 'intent', status: 'WAITING', reason: null, targetId: null, offerId: null, createdAt: metadata.lastSyncedAt, completedAt: null,
    legs: [{ user: { id: 'me', firstName: 'Ole Markus', lastName: 'Rockstad' }, give: snapshot(mine), receive: snapshot(friday), consentSource: null, consentedAt: null }] }] : [],
  assignmentStates: [state(onNow), state(mine, review ? { relatedCandidateIds: ['candidate'], availableActions: ['CONFIRM_CANDIDATE'] } : {}),
    state(friday, available ? { offerableIntentIds: ['intent'] } : {})],
});
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  account.permissions = ['duty_ops.view', 'duty_ops.swap'];
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mock = ({ review = false, available = false, balance = 0, gate }: { review?: boolean; available?: boolean; balance?: number; gate?: Promise<void> } = {}) =>
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (gate) await gate;
    if (path === '/api/duty-ops') return Response.json(data);
    if (path.startsWith('/api/exchanges/v2/intents?')) return Response.json(v2({ review, available }));
    return Response.json({ currentUserId: 'me', currentUserCreditBalance: balance, requests: [], lockedShiftIds: [], nextCursor: null });
  }));
const render = (route = '/duty-ops', view: 'schedule' | 'exchanges' = 'schedule') =>
  act(async () => root.render(<MemoryRouter initialEntries={[route]}><DutyOpsPage view={view} /></MemoryRouter>));
const tabs = () => [...host.querySelectorAll('.duty-tabs a')].map(tab => [tab.textContent, tab.getAttribute('href'), tab.getAttribute('aria-current')]);
const cardOrder = () => [...host.querySelectorAll('.duty-layout > .card')].map(card => card.querySelector('h2')?.textContent);

describe('Duty Ops redesign', () => {
  it('links the Schedule, Exchanges and Activity tabs and marks the current one on both routes', async () => {
    mock(); await render();
    expect(tabs()).toEqual([['Schedule', '/duty-ops', 'page'], ['Exchanges', '/duty-ops/exchanges', null], ['Activity', '/activity?module=duty-ops', null]]);
    await act(async () => root.unmount()); root = createRoot(host);
    await render('/duty-ops/exchanges', 'exchanges');
    expect(tabs().map(tab => tab[2])).toEqual([null, 'page', null]);
  });
  it('hides the Exchanges tab and card without the swap permission', async () => {
    account.permissions = ['duty_ops.view']; mock(); await render();
    expect(tabs().map(tab => tab[0])).toEqual(['Schedule', 'Activity']);
    expect(host.querySelector('.duty-exchanges-card')).toBeNull();
  });
  it('shows how long the current shift has left and how far it has come', async () => {
    expect(endsInLabel({ endsAt: '2026-09-30T15:00:00Z' }, now)).toBe('Ends in 43 min');
    expect(endsInLabel({ endsAt: '2026-09-30T18:00:00Z' }, now)).toBe('Ends in 3 h');
    expect(shiftProgress(onNow, now)).toBe(82);
    mock(); await render();
    const card = host.querySelector('.duty-now')!;
    expect(card.querySelector('.duty-now-ends')?.textContent).toBe('Ends in 43 min');
    expect(card.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('82');
    expect(card.querySelector('.duty-participants')?.textContent).toBe('Anna Berg · 2 others');
  });
  it('shows signed-in students as name codes and the others as dots', () => {
    const html = (people: DutyShift['participants'], label: string) => {
      const box = document.createElement('div'); box.innerHTML = renderToStaticMarkup(<PeopleStack people={people} total={3} label={label} />); return box;
    };
    const one = html([anna], 'Anna Berg · 2 others');
    expect([...one.querySelectorAll('.people-code')].map(code => code.textContent)).toEqual(['ABE']);
    expect(one.querySelectorAll('.people-dot')).toHaveLength(2);
    expect(one.querySelector('.sr-only')?.textContent).toBe('Anna Berg · 2 others');
    expect(html([], '3 students').querySelectorAll('.people-dot')).toHaveLength(3);
    const both = html([anna, me], 'You · Anna Berg · 1 other');
    expect([...both.querySelectorAll('.people-code')].map(code => [code.textContent, code.classList.contains('is-you')])).toEqual([['ORO', true], ['ABE', false]]);
  });
  it('groups the schedule by day and links only the user’s own shifts', async () => {
    expect(dayHeading('2026-09-30', '2026-09-30')).toEqual({ label: 'Today', date: 'Wed 30 Sept' });
    expect(dayHeading('2027-01-04', '2026-12-30')).toEqual({ label: 'Monday', date: 'Mon 4 Jan 2027' });
    mock(); await render();
    const days = [...host.querySelectorAll('.duty-schedule .duty-day h3 strong')].map(day => day.textContent);
    expect(days).toEqual(['Today', 'Tomorrow', 'Friday']);
    expect(host.querySelector('.duty-schedule .duty-day .duty-row-end')?.textContent).toBe('On now');
    expect(host.querySelector('.duty-schedule a[href="/duty-ops/shifts/mine"]')).not.toBeNull();
    expect(host.querySelector('.duty-schedule a[href="/duty-ops/shifts/fri"]')).toBeNull();
    expect(host.querySelector('.duty-schedule .is-mine .duty-participants')?.textContent).toBe('You · Anna Berg · 1 other');
  });
  it('counts exchanges in the tiles and shows the credit balance', async () => {
    mock({ available: true, balance: 1 }); await render();
    const stats = [...host.querySelectorAll('.duty-stat')].map(stat => stat.textContent);
    expect(stats).toEqual(['1Available', '0Requests', '0Needs review']);
    expect(host.querySelector('.duty-credit')?.textContent).toContain('Credit balance +1');
    expect(host.querySelector('.duty-tab-badge')).toBeNull();
    expect(cardOrder()).toEqual(['On duty now', 'Your shifts', 'Exchanges', 'Schedule']);
  });
  it('badges the Exchanges tab and moves the card up when something needs an answer', async () => {
    mock({ review: true, balance: -2 }); await render();
    expect(host.querySelector('.duty-tab-badge')?.textContent).toBe('1');
    expect(host.querySelector('.duty-stat.is-warning')?.textContent).toBe('1Needs review');
    expect(cardOrder()).toEqual(['On duty now', 'Exchanges', 'Your shifts', 'Schedule']);
    const row = host.querySelector('.duty-exchanges-card .exchange-row.needs-answer')!;
    expect(row.textContent).toContain('You give Thu 1 Oct · 08:00–13:00');
    expect([...row.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Accept', 'Decline']);
    expect(host.querySelector('.duty-credit')?.textContent).toContain('Credit balance -2');
  });
  it('shows skeletons until Duty Ops loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mock({ gate }); await render();
    expect(host.querySelector('[aria-label="Loading Duty Ops"]')).not.toBeNull();
    expect(host.querySelector('.duty-tabs')).not.toBeNull();
    await act(async () => { release(); await gate; });
    expect(host.querySelector('[aria-label="Loading Duty Ops"]')).toBeNull();
    expect(host.querySelector('.duty-subline')?.textContent).toBe('Synced 16:17 · 60 days from FlightLogger');
  });
});
