// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { CredentialForm } from '../src/features/flightlogger/CredentialForm';

vi.mock('../src/pwa/PwaProvider', () => ({ PwaProvider: ({ children }: { children: ReactNode }) => children,
  usePwa: () => ({ canInstall: false, installed: false, installing: false, needsUpdate: false, error: '', install: vi.fn(), update: vi.fn() }) }));

const state = { email: 'student@example.test', subject: 'verified-subject', firstName: null, lastName: null, onboardingComplete: false,
  hasFlightLoggerCredential: false, flightLoggerUserId: null as string | null,
  permissions: [], roles: ['STUDENT'] };
const connected = { ...state, onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-user' };
let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof vi.fn>;
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
async function render(path = '/') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><App /><Location /></MemoryRouter>); });
}
function button(label: string) { return [...host.querySelectorAll('button')].find(element => element.textContent === label)!; }
async function enter(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.scrollTo = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  api = vi.fn(async () => Response.json(state)); vi.stubGlobal('fetch', api);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('mandatory FlightLogger onboarding', () => {
  it('provides the API key setup guide and a new-tab link while retaining the credential form', async () => {
    await render('/onboarding');
    expect(host.querySelector('h1')!.textContent).toBe('Connect FlightLogger');
    const link = host.querySelector<HTMLAnchorElement>('.onboarding-guide a')!;
    expect(link.textContent).toBe('Open FlightLogger API keys');
    expect(link.href).toBe('https://my.flightlogger.net/my/api_keys');
    expect(link.target).toBe('_blank');
    expect(link.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    const steps = [...host.querySelectorAll('.onboarding-guide > li')].map(li => li.textContent);
    expect(steps).toHaveLength(7);
    expect(steps[1]).toContain('Create key');
    expect(steps[2]).toContain('any name');
    expect(steps[2]).toContain('Studentportal');
    expect(steps[3]).toContain('Global is not checked');
    expect(steps[3]).toContain('No expiry is checked');
    expect(steps[4]).toBe('Click Create.');
    expect(steps[5]).toContain('Copy the API key');
    expect(steps[6]).toContain('paste the key below');
    const input = host.querySelector<HTMLInputElement>('input[name="flightlogger-api-key"]')!;
    expect(input.type).toBe('password');
    expect(input.required).toBe(true);
    expect(host.querySelector(`label[for="${input.id}"]`)!.textContent).toBe('FlightLogger API key');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Your API key is stored securely and is only used by Studentportal to access your FlightLogger data.');
    expect(button('Connect FlightLogger').disabled).toBe(true);
    expect(host.textContent).not.toContain('API reference');
    expect(host.textContent).not.toContain('Help Center');
  });
  it.each(['/', '/admin/availability', '/duty-ops', '/activity', '/settings'])('redirects an incomplete user from %s', async path => {
    await render(path);
    expect(host.querySelector('output')!.textContent).toBe('/onboarding');
    expect(host.querySelector('h1')!.textContent).toBe('Connect FlightLogger');
    expect(host.querySelector('.portal-shell')).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
  });
  it.each(['/duty-ops', '/activity', '/settings'])('preserves completed-user portal navigation at %s', async path => {
    api.mockImplementation(async () => Response.json(connected)); await render(path);
    expect(host.querySelector('output')!.textContent).toBe(path);
    expect(host.querySelector('[aria-label="Main navigation"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Mobile navigation"]')).not.toBeNull();
  });
  it('redirects a completed user away from onboarding to Home', async () => {
    api.mockImplementation(async () => Response.json(connected)); await render('/onboarding');
    expect(host.querySelector('output')!.textContent).toBe('/');
    expect(host.querySelector('h1')!.textContent).toBe('Home');
  });
  it('does not render operations while identity is loading or unavailable', async () => {
    let resolve!: (value: Response) => void;
    api.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    await render('/availability');
    expect(host.textContent).toContain('Loading your portal account');
    expect(host.querySelector('.portal-shell')).toBeNull();
    await act(async () => resolve(Response.json({ error: 'Database unavailable.' }, { status: 503 })));
    expect(host.textContent).toContain('Your portal account could not be loaded');
    expect(host.querySelector('.portal-shell')).toBeNull();
  });
  it('submits only to the relative endpoint, refreshes identity and discards the key without browser persistence', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const cache = vi.fn(); const indexed = vi.fn();
    vi.stubGlobal('caches', { open: cache }); vi.stubGlobal('indexedDB', { open: indexed });
    let meCount = 0;
    api.mockImplementation(async (url: string) => url === '/api/me'
      ? Response.json(++meCount === 1 ? state : connected)
      : Response.json({ connected: true, flightLoggerUserId: 'fl-user' }));
    await render('/onboarding');
    await enter('test-personal-key'); await submit();
    expect(host.querySelector('output')!.textContent).toBe('/');
    expect(host.querySelector('input[type=password]')).toBeNull();
    expect(host.textContent).not.toContain('test-personal-key');
    expect(meCount).toBe(2);
    const [, init] = api.mock.calls.find(([url]) => url === '/api/onboarding/flightlogger')!;
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', body: '{"apiKey":"test-personal-key"}' });
    expect(api.mock.calls.every(([url]) => url.startsWith('/api/') && !url.includes('test-personal-key'))).toBe(true);
    expect(local).not.toHaveBeenCalled(); expect(cache).not.toHaveBeenCalled(); expect(indexed).not.toHaveBeenCalled();
  });
  it('retains Connected status and the existing portal when replacement fails', async () => {
    api.mockImplementation(async (url: string) => url === '/api/me' ? Response.json(connected)
      : Response.json({ error: 'The FlightLogger API key could not be verified.' }, { status: 422 }));
    await render('/settings');
    await act(async () => button('Replace API key').click());
    const input = await enter('bad-replacement'); await submit();
    expect(host.querySelector('[role=alert]')!.textContent).toContain('could not be verified');
    expect(input.value).toBe('bad-replacement');
    expect(host.querySelector('.connection-status')!.textContent).toBe('Connected');
    expect(host.querySelector('output')!.textContent).toBe('/settings');
    await act(async () => button('Cancel').click());
    expect(host.querySelector('input')).toBeNull();
  });
});

describe('credential form lifecycle', () => {
  it('clears the password input immediately after success, even before refresh resolves', async () => {
    // Use the default context's no-op refresh to inspect the retained form directly.
    await act(async () => root.render(<CredentialForm />));
    api.mockImplementation(async () => Response.json({ connected: true, flightLoggerUserId: 'fl-user' }));
    const input = await enter('sensitive-input'); await submit();
    expect(input.value).toBe('');
    expect(input.type).toBe('password'); expect(input.autocomplete).toBe('off');
    expect(button('Connect FlightLogger').disabled).toBe(true);
  });
  it('disables repeat submission during validation and handles network failure safely', async () => {
    let reject!: (reason: Error) => void;
    api.mockImplementation(() => new Promise<Response>((_resolve, fail) => { reject = fail; }));
    await act(async () => root.render(<CredentialForm />));
    await enter('personal-key'); await submit();
    expect(button('Verifying connection…').disabled).toBe(true);
    await submit(); expect(api).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('transport failure')));
    expect(host.querySelector('[role=alert]')!.textContent).toContain('Could not reach');
    expect(button('Connect FlightLogger').disabled).toBe(false);
  });
});
