export type CurrentUser = {
  email: string;
  subject: string;
  onboardingComplete: boolean;
  hasFlightLoggerCredential: boolean;
  flightLoggerUserId: string | null;
};

export async function loadCurrentUser(signal: AbortSignal): Promise<CurrentUser> {
  let response: Response;
  try {
    response = await fetch('/api/me', { signal, credentials: 'same-origin', cache: 'no-store' });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error('Could not load your account. Check your connection, or reload the page to sign in again.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 || response.redirected) {
    throw new Error('Your Access session may have expired. Reload the page to sign in again.');
  }
  if (!response.ok) throw new Error('Your account could not be loaded. Try again shortly.');
  if (typeof body !== 'object' || body === null || !('email' in body) || !('subject' in body) ||
      typeof body.email !== 'string' || !body.email || typeof body.subject !== 'string' || !body.subject ||
      !('onboardingComplete' in body) || typeof body.onboardingComplete !== 'boolean' ||
      !('hasFlightLoggerCredential' in body) || typeof body.hasFlightLoggerCredential !== 'boolean' ||
      body.onboardingComplete !== body.hasFlightLoggerCredential ||
      !('flightLoggerUserId' in body) || (body.flightLoggerUserId !== null && typeof body.flightLoggerUserId !== 'string')) {
    throw new Error('The account service returned an unexpected response.');
  }
  return { email: body.email, subject: body.subject, onboardingComplete: body.onboardingComplete,
    hasFlightLoggerCredential: body.hasFlightLoggerCredential, flightLoggerUserId: body.flightLoggerUserId };
}
