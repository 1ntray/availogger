import { ApplicationError } from '../application-error';
import { requireSameOrigin } from '../same-origin';
import { isTransportLocation, MAX_PASSENGER_SEATS, type TransportLocation } from '../../shared/transport';

export function invalid(message = 'Submit valid Transport details.'): never { throw new ApplicationError(message, 400, 'INVALID_TRANSPORT_REQUEST'); }
export async function readTransportBody(request: Request, required: string[], optional: string[] = []): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  if (new URL(request.url).search) invalid('Transport changes do not accept query parameters.');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApplicationError('Submit Transport changes as JSON.', 415);
  const limit = 4096;
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApplicationError('Transport request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ApplicationError('Transport request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { invalid('Submit valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || required.some(key => !Object.hasOwn(body, key)) ||
      Object.keys(body).some(key => !required.includes(key) && !optional.includes(key))) invalid();
  return body as Record<string, unknown>;
}
export function resourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value)) invalid('Select an existing Transport resource.');
  return value;
}
export function location(value: unknown): TransportLocation {
  if (!isTransportLocation(value)) invalid('Choose Istind, UTSA or Næringshagen.');
  return value;
}
export function canonicalTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid('Choose a valid departure time.');
  return value;
}
export function futureTime(value: unknown, now: string): string {
  const time = canonicalTime(value);
  if (time <= now || Date.parse(time) - Date.parse(now) > 366 * 86400000) invalid('Choose a future departure within one year.');
  return time;
}
export function rideText(value: unknown, max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid('Use short, valid ride details.');
  return value.trim();
}
export function seatCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PASSENGER_SEATS) invalid(`Choose 1–${MAX_PASSENGER_SEATS} passenger seats.`);
  return value;
}
