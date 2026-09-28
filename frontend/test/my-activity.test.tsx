// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MyActivityPage } from '../src/pages/MyActivityPage';

const duty = vi.fn();
const flyvask = vi.fn();
const brakkevakt = vi.fn();
let permissions = ['duty_ops.view', 'flyvask.view', 'brakkevakt.view'];
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { subject: 'me', permissions } }) }));
vi.mock('../src/features/duty-ops/exchange-api', () => ({ loadSwapHistory: (...args: unknown[]) => duty(...args) }));
vi.mock('../src/features/flyvask/exchange-api', () => ({ loadSwapHistory: (...args: unknown[]) => flyvask(...args) }));
vi.mock('../src/features/brakkevakt/api', () => ({ loadHistory: (...args: unknown[]) => brakkevakt(...args) }));

const person = { id: 'other', firstName: 'Anna', lastName: null };
const shift = { id: 'shift', startsAt: '2026-09-29T07:00:00Z', endsAt: '2026-09-29T11:00:00Z' };
const dutyEntry = { id: 'duty', type: 'GIVE_AWAY', counterparty: person, givenShift: shift, receivedShift: null, acceptedAt: '2026-09-27T09:00:00Z' };
const flyvaskEntry = { ...dutyEntry, id: 'flyvask', type: 'DIRECT_SWAP', receivedShift: shift, acceptedAt: '2026-09-27T11:00:00Z' };
const brakkeEntry = { id: 'brakke', counterparty: person, givenWeekStart: '2026-09-28', receivedWeekStart: '2026-10-05', acceptedAt: '2026-09-27T10:00:00Z' };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  permissions = ['duty_ops.view', 'flyvask.view', 'brakkevakt.view'];
  duty.mockReset().mockResolvedValue({ entries: [dutyEntry], nextCursor: null });
  flyvask.mockReset().mockResolvedValue({ entries: [flyvaskEntry], nextCursor: null });
  brakkevakt.mockReset().mockResolvedValue({ entries: [brakkeEntry], nextCursor: null });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<MemoryRouter><MyActivityPage /></MemoryRouter>)); }

it('combines accepted exchanges chronologically and filters without refetching', async () => {
  await render();
  expect([...host.querySelectorAll('.activity-list > li > span')].map(node => node.textContent)).toEqual(['Flyvask', 'Brakkevakt', 'Duty Ops']);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Duty Ops')!.click());
  expect([...host.querySelectorAll('.activity-list > li > span')].map(node => node.textContent)).toEqual(['Duty Ops']);
  expect(duty).toHaveBeenCalledTimes(1);
  expect(flyvask).toHaveBeenCalledTimes(1);
  expect(brakkevakt).toHaveBeenCalledTimes(1);
});

it('loads only permitted history and keeps a failed source from hiding the others', async () => {
  permissions = ['duty_ops.view', 'brakkevakt.view'];
  duty.mockRejectedValue(new Error('Duty history unavailable'));
  await render();
  expect(flyvask).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Duty history unavailable');
  expect(host.querySelector('.activity-list')?.textContent).toContain('Swapped with Anna');
  expect([...host.querySelectorAll('.activity-filters button')].map(button => button.textContent)).toEqual(['All', 'Duty Ops', 'Brakkevakt']);
});

it('never requests module history without a view permission', async () => {
  permissions = [];
  await render();
  expect(duty).not.toHaveBeenCalled();
  expect(flyvask).not.toHaveBeenCalled();
  expect(brakkevakt).not.toHaveBeenCalled();
  expect(host.textContent).toContain('No accepted activity yet');
});
