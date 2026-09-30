import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

// SSR route tests don't register a browser service worker.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
import { PortalRoutes } from '../src/app/App';
import { loadCurrentUser } from '../src/app/current-user-api';
import * as account from '../src/app/CurrentUser';
import type { PermissionKey } from '../../shared/authorization';

const completed = { email: 'student@example.com', subject: 'verified-subject', firstName: 'Student', lastName: 'Example', onboardingComplete: true,
  hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-user', roles: ['STUDENT'] as ['STUDENT'],
  permissions: ['availability.view', 'duty_ops.view', 'flights.view', 'flyvask.view', 'brakkevakt.view', 'fuel.request'] as PermissionKey[] };
beforeEach(() => vi.spyOn(account, 'useCurrentUser').mockReturnValue({ user: completed, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('portal routes', () => {
  it.each([
    ['/', 'Home'], ['/admin/availability', 'Instructor availability'],
    ['/duty-ops', 'Duty Ops'], ['/duty-ops/shifts/00000000-0000-0000-0000-000000000001', 'Duty Ops shift'],
    ['/flights', 'Flights'], ['/flyvask', 'Flyvask'], ['/brakkevakt', 'Brakkevakt'], ['/settings', 'Settings'], ['/activity', 'My activity'], ['/admin', 'Administration'],
    ['/missing', 'Page not found'],
  ])('renders %s with the portal navigation', (route, heading) => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><PortalRoutes /></MemoryRouter>);
    // Home greets the user by time of day instead of titling itself "Home".
    if (route === '/') expect(html).toMatch(/<h1>Good (morning|afternoon|evening)/);
    else expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html).toContain('Luftfartsfag');
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).not.toContain('href="/transport"');
    expect(html).not.toContain('Availogger');
    if (['/', '/flights', '/duty-ops', '/flyvask', '/brakkevakt'].includes(route)) expect(html).toContain('aria-current="page"');
  });
  it('retains the availability controls and loading state after extraction', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin/availability']}><PortalRoutes /></MemoryRouter>);
    for (const text of ['Europe/Oslo', 'Find instructor', 'Refresh availability', 'Next dates', 'No information', 'Loading instructor availability']) expect(html).toContain(text);
  });
  it('Home starts with the personal schedule without duplicate quick-access cards', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PortalRoutes /></MemoryRouter>);
    expect(html).toContain('Loading schedule');
    expect(html).toContain('href="/duty-ops"');
    expect(html).not.toContain('Quick access');
  });
  it('hides forbidden modules in desktop/mobile navigation and Home, and guards manual routes', () => {
    vi.mocked(account.useCurrentUser).mockReturnValue({ user: { ...completed, permissions: [] }, loading: false, error: '', retry: vi.fn(), refresh: vi.fn() });
    const home = renderToStaticMarkup(<MemoryRouter><PortalRoutes /></MemoryRouter>);
    for (const path of ['/admin/availability', '/duty-ops', '/admin/users']) {
      expect(home).not.toContain(`href="${path}"`);
      const page = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><PortalRoutes /></MemoryRouter>);
      expect(page).toContain('<h1>Access denied</h1>');
    }
    expect(home).toContain('aria-controls="account-menu"');
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
