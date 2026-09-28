// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DutyCreditAuditPage } from '../src/pages/DutyCreditAuditPage';
import { isCreditSummary, loadCredits, loadCreditStandings, loadCreditSummary } from '../src/features/duty-ops/credit-api';
import type { CreditsResponse, CreditStandingsResponse } from '../../shared/duty-ops-credits';

let host: HTMLDivElement, root: Root, fetcher: ReturnType<typeof vi.fn>;
const student = { id: 'other', firstName: 'Anna', lastName: 'Student' };
const entry = { id: 'entry', amount: -1 as const, reason: 'DUTY_OPS_COVERAGE' as const, exchangeRequestId: 'request', counterparty: student,
  shift: { id: null, startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T10:00:00.000Z' }, createdAt: '2026-09-27T08:00:00.000Z' };
const credits: CreditsResponse = { balance: -2, coveredCount: 1, receivedCount: 3, entries: [entry], nextCursor: null };
const standings: CreditStandingsResponse = { topContributors: [{ student, balance: 2, coveredCount: 3, receivedCount: 1 }],
  students: [{ student, balance: 2, coveredCount: 3, receivedCount: 1 }, { student: { id: 'me', firstName: null, lastName: null }, balance: -2, coveredCount: 1, receivedCount: 3 }] };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetcher = vi.fn(async (path: string) => Response.json(path.endsWith('/standings') ? standings : credits)); vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<MemoryRouter><DutyCreditAuditPage /></MemoryRouter>));
describe('Duty Ops credit audit', () => {
  it('loads full standings only on the audit page and shows signed balances without private fields', async () => {
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('Duty Ops credit audit');
    expect(host.textContent).toContain('Top contributors');
    expect(host.textContent).toContain('Anna Student');
    expect([...host.querySelectorAll('tbody td')].map(cell => cell.textContent)).toContain('+2');
    expect(host.querySelector('tbody tr:last-child th')?.textContent).toBe('Student');
    expect(host.innerHTML).not.toMatch(/email|token|access_subject/);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/duty-ops/credits/standings']);
  });
  it('keeps a failed audit retryable', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ code: 'FORBIDDEN' }, { status: 403 }));
    await render();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('do not have access');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('table')).not.toBeNull();
  });
  it('rejects malformed personal statistics, histories and standings', async () => {
    expect(isCreditSummary({ balance: 0, coveredCount: 0, receivedCount: 1 })).toBe(false);
    fetcher.mockResolvedValue(Response.json({ ...credits, entries: [{ ...entry, amount: 2 }] }));
    await expect(loadCredits(new AbortController().signal)).rejects.toThrow('unexpected history');
    fetcher.mockResolvedValue(Response.json({ ...credits, coveredCount: -1 }));
    await expect(loadCreditSummary(new AbortController().signal)).rejects.toThrow('unexpected summary');
    fetcher.mockResolvedValue(Response.json({ students: [], topContributors: [{ ...standings.topContributors[0], balance: 999 }] }));
    await expect(loadCreditStandings(new AbortController().signal)).rejects.toThrow('unexpected standings');
  });
});
