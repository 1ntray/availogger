// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackLink, ContextLink } from '../src/app/controls';
import { safeReturnLocation } from '../src/app/return-navigation';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const routes = <Routes>
  <Route path="/" element={<><h1>Home</h1><ContextLink to="/duty-ops/shifts/a">Shift</ContextLink></>} />
  <Route path="/duty-ops" element={<><h1>Duty Ops</h1><ContextLink to="/duty-ops/shifts/a">Shift</ContextLink></>} />
  <Route path="/duty-ops/shifts/:id" element={<><h1>Shift</h1><BackLink to="/duty-ops">Duty Ops</BackLink><ContextLink to="/duty-ops/exchanges">Exchange</ContextLink></>} />
  <Route path="/duty-ops/exchanges" element={<><h1>Exchanges</h1><BackLink to="/duty-ops">Duty Ops</BackLink></>} />
  <Route path="/admin" element={<><h1>Administration</h1><ContextLink to="/admin/duty-ops/credits">Credits</ContextLink></>} />
  <Route path="/admin/duty-ops/credits" element={<><h1>Credits</h1><BackLink to="/admin">Administration</BackLink></>} />
</Routes>;
async function render(start: string | { pathname: string; search?: string; hash?: string; state?: unknown }) {
  await act(async () => root.render(<MemoryRouter initialEntries={[start]}>{routes}</MemoryRouter>));
}
async function follow(label: string) {
  const link = [...host.querySelectorAll('a')].find(item => item.textContent?.includes(label));
  expect(link).toBeDefined();
  await act(async () => link!.click());
}
it.each([['/', 'Home'], ['/duty-ops', 'Duty Ops']])('returns from a shift to its actual source %s', async (source, label) => {
  await render(source); await follow('Shift');
  expect(host.querySelector('.back-link')?.textContent).toContain(label);
  await follow(label);
  expect(host.querySelector('h1')?.textContent).toBe(label);
});
it('preserves nested return chain, query and hash', async () => {
  await render('/duty-ops?week=40#mine'); await follow('Shift'); await follow('Exchange');
  expect(host.querySelector('.back-link')?.textContent).toContain('Duty Ops shift');
  await follow('Duty Ops shift');
  expect(host.querySelector('.back-link')?.getAttribute('href')).toBe('/duty-ops?week=40#mine');
});
it('uses the fallback for direct URLs and rejects unsafe saved locations', async () => {
  await render({ pathname: '/duty-ops/shifts/a', state: { returnTo: { pathname: '//evil.test', search: '', hash: '', label: 'Outside' } } });
  expect(host.querySelector('.back-link')?.getAttribute('href')).toBe('/duty-ops');
  expect(safeReturnLocation({ pathname: 'https://evil.test', search: '', hash: '', label: 'Outside' })).toBeNull();
  expect(safeReturnLocation({ pathname: '/outside', search: '', hash: '', label: 'Outside' })).toBeNull();
});
it('returns from a credit audit to Administration', async () => {
  await render('/admin'); await follow('Credits');
  expect(host.querySelector('.back-link')?.textContent).toContain('Administration');
});
