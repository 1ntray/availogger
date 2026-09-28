// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionButton, BackLink, PageHeader, RefreshControl } from '../src/app/controls';

const host = document.createElement('div');
document.body.append(host);
const root = createRoot(host);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(async () => { await act(async () => root.render(null)); });

it('keeps the page heading, navigation and refresh utility semantic', async () => {
  const refresh = vi.fn();
  await act(async () => root.render(<MemoryRouter><BackLink to="/duty-ops">Duty Ops</BackLink>
    <PageHeader title="Shift"><RefreshControl label="shift" updatedAt="2026-09-27T08:00:00Z" now={Date.parse('2026-09-27T08:00:00Z')} onRefresh={refresh} /></PageHeader>
    <ActionButton variant="primary">Save changes</ActionButton><ActionButton variant="danger">Remove</ActionButton></MemoryRouter>));
  expect(host.querySelector('h1')?.textContent).toBe('Shift');
  expect(host.querySelector('a[href="/duty-ops"]')?.textContent).toContain('Duty Ops');
  expect(host.querySelector('time')?.textContent).toBe('Updated just now');
  expect(host.textContent).not.toContain('Updated Updated');
  expect(host.querySelectorAll('button')).toHaveLength(3);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh shift"]')?.type).toBe('button');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh shift"]')!.click());
  expect(refresh).toHaveBeenCalledOnce();
  expect([...host.querySelectorAll('button')].map(button => button.textContent)).toContain('Save changes');
});

it('makes Retry explicit when source data is stale', async () => {
  await act(async () => root.render(<RefreshControl label="flights" retry onRefresh={() => {}} />));
  expect(host.querySelector('button[aria-label="Retry flights"]')?.textContent).toContain('Retry');
});
