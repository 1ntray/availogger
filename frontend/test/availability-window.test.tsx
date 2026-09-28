// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AvailabilityPage from '../src/pages/AvailabilityPage';
import { loadAvailability, OnboardingRequiredError } from '../src/api';
import * as account from '../src/app/CurrentUser';
import { addDays } from '../src/dates';

vi.mock('../src/api', async original => ({ ...await original<typeof import('../src/api')>(), loadAvailability: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let width: number;
let resized: ResizeObserverCallback;
const refresh = vi.fn(async () => {});
const load = vi.mocked(loadAvailability);
function button(name: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
function request() { return load.mock.calls.at(-1)!; }
function dateHeaders() { return [...host.querySelectorAll('.date-row th')].map(element => element.getAttribute('title')); }
async function resize(nextWidth: number) {
  width = nextWidth;
  await act(async () => { resized([], {} as ResizeObserver); vi.advanceTimersByTime(120); });
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  width = 1040;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe() {} disconnect() {}
  });
  refresh.mockClear();
  vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: null, loading: false, error: '', retry: vi.fn(), refresh });
  load.mockReset();
  load.mockImplementation(async (from, to) => ({ from, to, timeZone: 'Europe/Oslo', cachedAt: '2026-09-27T09:30:00.000Z', instructors: [{ id: '1', firstName: 'Ada', lastName: 'Pilot', callSign: 'AP', days: Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 }, (_, index) => index === 0 ? 'available' : 'unavailable') }] }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<AvailabilityPage />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('continuous availability window', () => {
  it('measures before fetching and renders exactly the bounded requested range', () => {
    expect(load).toHaveBeenCalledTimes(1);
    expect(request().slice(0, 2)).toEqual(['2026-09-27', '2026-10-22']);
    expect(dateHeaders()).toHaveLength(26);
    expect(dateHeaders().at(0)).toBe(request()[0]);
    expect(dateHeaders().at(-1)).toBe(request()[1]);
    expect(host.querySelector('.date-window-nav span')!.textContent).toBe('27 Sept – 22 Oct 2026');
    expect(host.querySelector('caption')!.textContent).toContain('27 Sept – 22 Oct 2026');
  });
  it('Next and Previous move adjacent windows, including dates before today', async () => {
    const [from, to] = request();
    await click(button('Next dates'));
    expect(request()[0]).toBe(addDays(to, 1));
    await click(button('Previous dates'));
    expect(request().slice(0, 2)).toEqual([from, to]);
    await click(button('Previous dates'));
    expect(request()[0]).toBe('2026-09-01');
    expect(request()[1]).toBe('2026-09-26');
    expect(dateHeaders()[0]).toBe('2026-09-01');
    expect(host.querySelector('tbody td')!.title).toBe('AP, 2026-09-01: available');
    expect(button('Previous dates').disabled).toBe(false);
  });
  it('Today resets the first date rather than a month offset', async () => {
    await click(button('Next dates'));
    await click(host.querySelector<HTMLButtonElement>('.today-button')!);
    expect(request()[0]).toBe('2026-09-27');
    expect(host.querySelector<HTMLButtonElement>('.today-button')!.disabled).toBe(true);
  });
  it('resize keeps a navigated start stable and changes only the visible end', async () => {
    await click(button('Next dates'));
    const [from, to, signal] = request();
    await resize(720);
    expect(signal.aborted).toBe(true);
    expect(request()[0]).toBe(from);
    expect(request()[1] < to).toBe(true);
    expect(dateHeaders()).toHaveLength(16);
    await resize(1400);
    expect(request()[0]).toBe(from);
    expect(request()[1] > to).toBe(true);
    expect(dateHeaders().at(-1)).toBe(request()[1]);
  });
  it('debounces resize bursts and ignores width changes that fit the same number of days', async () => {
    width = 800;
    await act(async () => { resized([], {} as ResizeObserver); vi.advanceTimersByTime(100); });
    width = 720;
    await act(async () => { resized([], {} as ResizeObserver); vi.advanceTimersByTime(119); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(load).toHaveBeenCalledTimes(2);
    await resize(721);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('reload requests the same range, and retains useful statuses and no scrolling instruction', async () => {
    const [from, to] = request();
    await click(button('Refresh availability'));
    expect(request().slice(0, 2)).toEqual([from, to]);
    expect(load).toHaveBeenCalledTimes(2);
    for (const text of ['Europe/Oslo', 'Updated 30 minutes ago', 'Available', 'Unavailable', 'No information']) expect(host.textContent).toContain(text);
    expect(host.textContent).not.toMatch(/scroll horizontally/i);
    expect(host.querySelector('.calendar-scroll')).toBeNull();
    expect(host.querySelector('.week-label')!.textContent).toBe('W39');
    expect(host.querySelector('.week-start')).not.toBeNull();
    expect(host.querySelector('.weekend')).not.toBeNull();
  });
  it('preserves instructor search and no-match feedback', async () => {
    const input = host.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'missing');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('No instructors match');
    expect(host.querySelector('table')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('retains errors and retries, and refreshes onboarding on the existing required response', async () => {
    load.mockRejectedValueOnce(new Error('Unavailable service'));
    await click(button('Refresh availability'));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Unavailable service');
    load.mockRejectedValueOnce(new OnboardingRequiredError());
    await click(host.querySelector<HTMLButtonElement>('.message button')!);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
