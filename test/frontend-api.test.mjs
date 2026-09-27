import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAvailability, OnboardingRequiredError } from '../frontend/src/api';

afterEach(() => vi.unstubAllGlobals());

describe('frontend API deployment errors', () => {
  it('distinguishes authorization denial from an expired Access session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'FORBIDDEN' }, { status: 403 })));
    await expect(loadAvailability('2026-09-01', '2026-10-31', new AbortController().signal)).rejects.toThrow('You do not have access');
  });
  it('signals mandatory onboarding independently of Access session errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'ONBOARDING_REQUIRED', error: 'Connect FlightLogger.' }, { status: 409 })));
    await expect(loadAvailability('2026-09-01', '2026-10-31', new AbortController().signal)).rejects.toBeInstanceOf(OnboardingRequiredError);
  });
  it('identifies Pages SPA fallback without calling it an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><title>Availogger</title></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })));
    await expect(loadAvailability('2026-09-01', '2026-10-31', new AbortController().signal))
      .rejects.toThrow('Check that Pages Functions are included in the deployment.');
  });

  it('asks for sign-in when Access redirects to its login page', async () => {
    const login = new Response('<html>Cloudflare Access sign-in</html>', { headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(login, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn(async () => login));
    await expect(loadAvailability('2026-09-01', '2026-10-31', new AbortController().signal))
      .rejects.toThrow('Reload the page to sign in again.');
  });

  it('keeps malformed JSON responses distinct from sign-in errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not JSON', { headers: { 'Content-Type': 'application/json' } })));
    await expect(loadAvailability('2026-09-01', '2026-10-31', new AbortController().signal))
      .rejects.toThrow('The availability service returned an unexpected response.');
  });
});
