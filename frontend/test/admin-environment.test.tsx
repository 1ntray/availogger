// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from '../src/pages/AdminPage';
import { DEVELOPMENT_ORIGIN, otherEnvironment, PRODUCTION_ORIGIN } from '../src/app/environments';

const account = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { permissions: account.permissions } }) }));

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<MemoryRouter><AdminPage /></MemoryRouter>));

describe('admin environment link', () => {
  it('links production and other hosts to the development build, and development back to production', () => {
    expect(otherEnvironment('student.luftfartsfag.no').href).toBe(`${DEVELOPMENT_ORIGIN}/`);
    expect(otherEnvironment('localhost').href).toBe(`${DEVELOPMENT_ORIGIN}/`);
    expect(otherEnvironment('dev.student.luftfartsfag.no')).toMatchObject({ href: `${PRODUCTION_ORIGIN}/`, label: 'Open production portal' });
  });

  it('shows the development build link to administrators in a new tab', async () => {
    account.permissions = ['admin.manage_users'];
    await render();
    const link = host.querySelector<HTMLAnchorElement>('.admin-environment a')!;
    expect(link.textContent).toContain('Open development build');
    expect(link.href).toBe(`${DEVELOPMENT_ORIGIN}/`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('hides the link from users without user administration', async () => {
    account.permissions = ['availability.view'];
    await render();
    expect(host.querySelector('.admin-environment')).toBeNull();
    expect(host.textContent).toContain('Instructor availability');
  });
});
