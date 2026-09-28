// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/app/AppShell';
import * as account from '../src/app/CurrentUser';

let root: Root, host: HTMLDivElement;
function Location() { return <output>{useLocation().pathname}</output>; }
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); window.scrollTo = vi.fn();
  vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: { email: 'student@example.test', subject: 'test', firstName: 'Student', lastName: 'Example', onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'test', roles: ['STUDENT'], permissions: ['flights.view', 'duty_ops.view', 'flyvask.view', 'brakkevakt.view'] }, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><Routes><Route element={<AppShell />}><Route path="*" element={<Location />} /></Route></Routes></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Global account and navigation', () => {
  it('uses the five permitted destinations in desktop and mobile navigation', () => {
    for (const nav of host.querySelectorAll('nav[aria-label="Main navigation"], nav[aria-label="Mobile navigation"]')) {
      expect([...nav.querySelectorAll('a')].map(link => link.textContent)).toEqual(['Home', 'Flights', 'Duty Ops', 'Flyvask', 'Brakkevakt']);
    }
    expect(host.textContent).not.toContain('Transport');
  });
  it('opens the compact account menu with email, activity and Settings', async () => {
    const trigger = host.querySelector<HTMLButtonElement>('.current-user')!;
    expect(trigger.textContent).toContain('Student Example');
    expect(trigger.textContent).not.toContain('student@example.test');
    await click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.account-menu')!.textContent).toContain('student@example.test');
    expect(host.querySelector('.account-menu a[href="/activity"]')).not.toBeNull();
    await click(host.querySelector('.account-menu a[href="/settings"]')!);
    expect(host.querySelector('output')!.textContent).toBe('/settings');
    expect(host.querySelector('.account-menu')).toBeNull();
  });
  it('closes on Escape and restores trigger focus', async () => {
    const trigger = host.querySelector<HTMLButtonElement>('.current-user')!;
    await click(trigger);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.account-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
