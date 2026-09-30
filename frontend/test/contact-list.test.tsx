// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContactListPage } from '../src/pages/ContactPages';

const account = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { permissions: account.permissions } }) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  account.permissions = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetcher = vi.fn(async () => Response.json({ threads: [], nextCursor: null }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/messages']}><Routes>
    <Route path="/messages" element={<ContactListPage />} />
  </Routes></MemoryRouter>));
}
it('keeps normal students on their own messages and never loads webmaster data', async () => {
  await render();
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/contact?']);
});
it('gives authorized webmasters separate My messages and Webmaster views', async () => {
  account.permissions = ['contact.webmaster.manage'];
  await render();
  expect([...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(['My messages', 'Webmaster']);
  await act(async () => (host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]).click());
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Webmaster');
  expect(host.textContent).toContain('Resolved');
  expect(fetcher.mock.calls.map(([url]) => url)).toContain('/api/admin/contact?status=OPEN');
});
