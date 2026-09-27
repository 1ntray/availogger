// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/app/AppShell';
import * as account from '../src/app/CurrentUser';

let root: Root;
let host: HTMLDivElement;
function Location() { return <output>{useLocation().pathname}</output>; }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.scrollTo = vi.fn();
  vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: { email: 'student@example.test', subject: 'test', onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'test', roles: ['STUDENT'], permissions: ['duty_ops.view', 'transport.view'] }, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><Routes><Route element={<AppShell />}><Route path="*" element={<Location />} /></Route></Routes></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Settings navigation', () => {
  it('shows Settings in the sidebar and keeps the header identity non-interactive', () => {
    expect(host.querySelector('.sidebar a[href="/settings"]')?.textContent).toBe('Settings');
    expect(host.querySelector('.current-user')?.textContent).toBe('student@example.test');
    expect(host.querySelector('.current-user')?.tagName).toBe('DIV');
    expect(host.querySelector('[aria-controls="account-navigation"]')).toBeNull();
  });
  it('opens Settings from the sidebar with its active state and content focus', async () => {
    await click(host.querySelector('.sidebar a[href="/settings"]')!);
    expect(host.querySelector('output')!.textContent).toBe('/settings');
    expect(host.querySelector('.sidebar a[href="/settings"]')!.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(host.querySelector('main'));
  });
  it('keeps Settings in mobile More navigation and closes More after navigation', async () => {
    const more = host.querySelector('[aria-controls="more-navigation"]')!;
    await click(more);
    const settings = host.querySelector('.more-panel a[href="/settings"]')!;
    expect(settings.querySelector('svg')!.getAttribute('stroke-width')).toBe('1.6');
    await click(settings);
    expect(host.querySelector('output')!.textContent).toBe('/settings');
    expect(host.querySelector('.more-panel')).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(host.querySelector('main'));
  });
});
