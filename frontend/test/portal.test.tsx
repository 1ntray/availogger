import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

// SSR route tests don't register a browser service worker.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
import { PortalRoutes } from '../src/app/App';
import { loadCurrentUser } from '../src/app/current-user-api';
import * as account from '../src/app/CurrentUser';
import type { PermissionKey } from '../../shared/authorization';

const completed = { email: 'student@example.com', subject: 'verified-subject', onboardingComplete: true,
  hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-user', roles: ['STUDENT'] as ['STUDENT'],
  permissions: ['availability.view', 'duty_ops.view', 'transport.view'] as PermissionKey[] };
beforeEach(() => vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: completed, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('portal routes', () => {
  it.each([
    ['/', 'Home'], ['/availability', 'Instructor availability'],
    ['/duty-ops', 'Duty Ops'], ['/transport', 'Transport'], ['/settings', 'Settings'],
    ['/missing', 'Page not found'],
  ])('renders %s with the portal navigation', (route, heading) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><PortalRoutes /></MemoryRouter>);
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html).toContain('Luftfartsfag');
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('href="/availability"');
    expect(html).not.toContain('Availogger');
    if (route !== '/missing') expect(html).toContain('aria-current="page"');
  });
  it('retains the availability controls and loading state after extraction', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/availability']}><PortalRoutes /></MemoryRouter>);
    for (const text of ['Europe/Oslo', 'Find instructor', 'Reload view', 'Next dates', 'No information', 'Loading instructor availability']) expect(html).toContain(text);
  });
  it('home links to implemented and planned tools without fake operational data', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PortalRoutes /></MemoryRouter>);
    expect(html).toContain('Nothing scheduled');
    expect(html).toContain('href="/duty-ops"');
    expect(html).toContain('href="/transport"');
  });
  it('hides forbidden modules in desktop/mobile navigation and Home, and guards manual routes', () => {
    vi.mocked(account.useCurrentUser).mockReturnValue({ user: { ...completed, permissions: [] }, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
    const home = renderToStaticMarkup(<MemoryRouter><PortalRoutes /></MemoryRouter>);
    for (const path of ['/availability', '/transport', '/duty-ops', '/admin/users']) {
      expect(home).not.toContain(`href="${path}"`);
      const page = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><PortalRoutes /></MemoryRouter>);
      expect(page).toContain('<h1>Access denied</h1>');
    }
    expect(home).toContain('href="/settings"');
  });
});

describe('current Access user', () => {
  it('fetches and validates identity from the same-origin API without persisting it', async () => {
    const fetcher = vi.fn(async () => Response.json({ ...completed, extra: 'omit' }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await loadCurrentUser(signal)).toEqual(completed);
    expect(fetcher).toHaveBeenCalledWith('/api/me', { signal, credentials: 'same-origin', cache: 'no-store' });
  });
  it.each([401,403])('handles denied Access identity (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'denied' }, { status })));
    await expect(loadCurrentUser(new AbortController().signal)).rejects.toThrow('Reload the page to sign in again.');
  });
  it('rejects malformed identity responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'student@example.com' })));
    await expect(loadCurrentUser(new AbortController().signal)).rejects.toThrow('unexpected response');
  });
});
