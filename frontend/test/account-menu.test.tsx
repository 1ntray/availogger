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
function trigger() { return host.querySelector<HTMLButtonElement>('[aria-controls="account-navigation"]')!; }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.scrollTo = vi.fn();
  vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: { email: 'student@example.test', subject: 'test', onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'test', roles: ['STUDENT'], permissions: ['duty_ops.view', 'transport.view'] }, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><Routes><Route element={<AppShell />}><Route path="*" element={<Location />} /></Route></Routes></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('account navigation', () => {
  it('removes Settings from the sidebar and preserves the account email', () => {
    expect(host.querySelector('.sidebar a[href="/settings"]')).toBeNull();
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger().textContent).toContain('student@example.test');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
  it('opens and closes with the account button and focuses Settings on open', async () => {
    await click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(host.querySelector('#account-navigation a'));
    await click(trigger());
    expect(host.querySelector('#account-navigation')).toBeNull();
  });
  it('Escape closes the dropdown and restores focus to its trigger', async () => {
    await click(trigger());
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });
  it('dismisses on outside pointer interaction', async () => {
    await click(trigger());
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(host.querySelector('#account-navigation')).toBeNull();
  });
  it('dismisses when keyboard focus leaves the account control', async () => {
    await click(trigger());
    await act(async () => host.querySelector<HTMLAnchorElement>('.brand')!.focus());
    expect(host.querySelector('#account-navigation')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.brand'));
  });
  it('Settings navigates to the existing route and closes the dropdown', async () => {
    await click(trigger());
    await click(host.querySelector('#account-navigation a')!);
    expect(host.querySelector('output')!.textContent).toBe('/settings');
    expect(host.querySelector('#account-navigation')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('main'));
  });
  it('uses the same outlined cog in account and mobile Settings links', async () => {
    await click(trigger());
    const cog = host.querySelector('#account-navigation svg')!;
    expect(cog.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(cog.getAttribute('stroke-width')).toBe('1.6');
    expect(cog.querySelector('path')!.getAttribute('d')).toContain('z M16 12');
    await click(host.querySelector('[aria-controls="more-navigation"]')!);
    expect(host.querySelector('.more-panel a[href="/settings"] path')!.getAttribute('d')).toBe(cog.querySelector('path')!.getAttribute('d'));
  });
});
