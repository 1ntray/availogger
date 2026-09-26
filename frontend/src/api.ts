import type { AvailabilityResponse } from './types';
import { isAvailabilityResponse } from './availability-response';
import { availabilityUrl } from './api-url';

export async function loadAvailability(from: string, to: string, signal: AbortSignal): Promise<AvailabilityResponse> {
  let response: Response;
  try {
    response = await fetch(availabilityUrl(from, to), { signal, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the availability service. Check your connection, or reload the page to sign in again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 || (response.ok && !body)) {
    throw new Error('Your Access session may have expired. Reload the page to sign in again.');
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Availability service returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!isAvailabilityResponse(body)) throw new Error('The availability service returned an unexpected response.');
  return body;
}
