// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyCreditsPage } from '../src/pages/DutyCreditsPage';
import { isCreditSummary, loadCredits, loadCreditStandings, loadCreditSummary } from '../src/features/duty-ops/credit-api';
import type { CreditsResponse, CreditStandingsResponse } from '../../shared/duty-ops-credits';

vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { subject: 'me' } }) }));
let host: HTMLDivElement, root: Root, credits: CreditsResponse, standings: CreditStandingsResponse;
const student = { id: 'other', firstName: 'Anna', lastName: 'Student' };
const entry = { id: 'entry', amount: -1 as const, reason: 'DUTY_OPS_COVERAGE' as const, exchangeRequestId: 'request', counterparty: student,
  shift: { id: null, startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T10:00:00.000Z' }, createdAt: '2026-09-27T08:00:00.000Z' };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  credits = { balance: -2, coveredCount: 1, receivedCount: 3, entries: [entry], nextCursor: null };
  standings = { topContributors: [{ student, balance: 2, coveredCount: 3, receivedCount: 1 }],
    students: [{ student, balance: 2, coveredCount: 3, receivedCount: 1 }, { student: { id: 'me', firstName: null, lastName: null }, balance: -2, coveredCount: 1, receivedCount: 3 }] };
  fetcher = vi.fn(async (path: string) => Response.json(path.endsWith('/standings') ? standings : credits)); vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = () => act(async () => root.render(<MemoryRouter initialEntries={['/duty-ops/credits']}><DutyCreditsPage /></MemoryRouter>));

describe('Duty Ops credits', () => {
  it('renders personal statistics and stored history, secondary navigation and neutral signed public balances', async () => {
    await render();
    expect([...host.querySelectorAll('dd')].map(e => e.textContent)).toEqual(['-2', '1', '3']);
    expect(host.textContent).toContain('Covered by Anna Student'); expect(host.querySelector('time')!.dateTime).toBe(entry.shift.startsAt);
    expect(host.querySelector('[aria-current=page]')!.textContent).toBe('Credits');
    expect(host.textContent).toContain('Direct swaps remain available');
    expect([...host.querySelectorAll('tbody td')].map(e => e.textContent)).toContain('+2');
    expect(host.querySelector('tbody tr:last-child th')!.textContent).toBe('Student');
    expect(host.querySelector('tbody .duty-alert')).toBeNull(); expect(host.innerHTML).not.toMatch(/email|token|access_subject/);
    expect(fetcher.mock.calls.every(([path, init]) => path.startsWith('/api/duty-ops/credits') && init.credentials === 'same-origin' && init.cache === 'no-store')).toBe(true);
  });
  it('appends keyset history without duplicates or requesting anyone else’s ledger', async () => {
    credits.nextCursor = 'cursor'; await render();
    fetcher.mockImplementation(async (path: string) => Response.json(path.includes('cursor=') ? { ...credits, entries: [entry, { ...entry, id: 'next' }], nextCursor: null } : credits));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Load more credit history')!.click());
    expect(host.querySelectorAll('.exchange-row')).toHaveLength(2);
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('?cursor=cursor'))).toBe(true);
  });
  it('refreshes balances without clearing older history pages', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); await render();
    credits = { ...credits, balance: -1, coveredCount: 2, entries: [] };
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.querySelector('dd')!.textContent).toBe('-1'); expect(host.querySelectorAll('.exchange-row')).toHaveLength(1);
  });
  it('shows safe permission failures with a usable reload', async () => {
    fetcher.mockImplementation(async () => Response.json({ code: 'FORBIDDEN' }, { status: 403 })); await render();
    expect(host.querySelector('[role=alert]')!.textContent).toContain('do not have access'); expect(host.querySelector('button')!.disabled).toBe(false);
  });
  it('rejects malformed history, inconsistent statistics and invalid standings', async () => {
    expect(isCreditSummary({ balance: 0, coveredCount: 0, receivedCount: 1 })).toBe(false);
    fetcher.mockResolvedValue(Response.json({ ...credits, entries: [{ ...entry, amount: 2 }] }));
    await expect(loadCredits(new AbortController().signal)).rejects.toThrow('unexpected history');
    fetcher.mockResolvedValue(Response.json({ ...credits, coveredCount: -1 }));
    await expect(loadCreditSummary(new AbortController().signal)).rejects.toThrow('unexpected summary');
    fetcher.mockResolvedValue(Response.json({ students: [], topContributors: [{ ...standings.topContributors[0], balance: 999 }] }));
    await expect(loadCreditStandings(new AbortController().signal)).rejects.toThrow('unexpected standings');
  });
});
