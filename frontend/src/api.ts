import type { AvailabilityResponse } from './types';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');

export async function loadAvailability(from: string, to: string, signal: AbortSignal): Promise<AvailabilityResponse> {
  const url = new URL(`${baseUrl}/api/availability`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);

  let response: Response;
  try {
    response = await fetch(url, { signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the availability service. Check the Worker URL and your connection.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Availability service returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!isAvailabilityResponse(body)) throw new Error('The availability service returned an unexpected response.');
  return body;
}

function isAvailabilityResponse(value: unknown): value is AvailabilityResponse {
  return typeof value === 'object' && value !== null &&
    'instructors' in value && Array.isArray(value.instructors) &&
    value.instructors.every((item: unknown) => typeof item === 'object' && item !== null &&
      'id' in item && typeof item.id === 'string' && 'days' in item && Array.isArray(item.days) &&
      item.days.every((day: unknown) => ['available', 'unavailable', 'undefined'].includes(String(day))));
}
