import type { AvailabilityResponse } from './types';
import { isAvailabilityResponse } from './availability-response';
import { availabilityUrl } from './api-url';

export class OnboardingRequiredError extends Error {}

export async function loadAvailability(from: string, to: string, signal: AbortSignal): Promise<AvailabilityResponse> {
  let response: Response;
  try {
    response = await fetch(availabilityUrl(from, to), { signal, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the availability service. Check your connection, or reload the page to sign in again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.status === 403 && body && typeof body === 'object' && 'code' in body && body.code === 'FORBIDDEN') {
    throw new Error('You do not have access to instructor availability.');
  }
  if (response.ok && !body && response.headers.get('Content-Type')?.includes('text/html') && !response.redirected) {
    throw new Error('The availability API returned a webpage instead of data. Check that Pages Functions are included in the deployment.');
  }
  if (response.status === 401 || response.status === 403 || (response.ok && !body && response.redirected)) {
    throw new Error('Your Access session may have expired. Reload the page to sign in again.');
  }
  if (!response.ok) {
    if (response.status === 409 && body && typeof body === 'object' && 'code' in body && body.code === 'ONBOARDING_REQUIRED') {
      throw new OnboardingRequiredError('Connect your FlightLogger account before loading availability.');
    }
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Availability service returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!isAvailabilityResponse(body)) throw new Error('The availability service returned an unexpected response.');
  return body;
}
