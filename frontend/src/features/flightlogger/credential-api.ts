export async function connectFlightLogger(apiKey: string, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/onboarding/flightlogger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', cache: 'no-store', signal, body: JSON.stringify({ apiKey }),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error('Could not reach the portal. Check your connection and try again.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('Your Access session may have expired. Reload the page to sign in again.');
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'FlightLogger could not be connected. Try again shortly.';
    throw new Error(message);
  }
  if (!body || typeof body !== 'object' || !('connected' in body) || body.connected !== true) throw new Error('The portal returned an unexpected connection response.');
}
