import { isTransportLocation, type CarsResponse, type RidesResponse } from '../../../../shared/transport';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
const booking = (value: unknown) => object(value) && id(value.id) && id(value.vehicleId) && isTransportLocation(value.origin) && isTransportLocation(value.destination) &&
  value.origin !== value.destination && time(value.startsAt) && time(value.endsAt) && Date.parse(value.endsAt as string) - Date.parse(value.startsAt as string) === 600000 &&
  ['BOOKED', 'CANCELLED'].includes(value.status as string) && (value.confirmedAt === null || time(value.confirmedAt)) && typeof value.isMine === 'boolean';
export function isCarsResponse(value: unknown): value is CarsResponse {
  return object(value) && time(value.now) && value.timeZone === 'Europe/Oslo' && Array.isArray(value.vehicles) && Array.isArray(value.bookings) && Array.isArray(value.pendingConfirmations) &&
    value.bookings.every(booking) && value.pendingConfirmations.every(booking) && value.vehicles.every(vehicle => object(vehicle) && id(vehicle.id) && typeof vehicle.name === 'string' &&
      (vehicle.reported === null || object(vehicle.reported) && isTransportLocation(vehicle.reported.location) && time(vehicle.reported.reportedAt)) &&
      object(vehicle.expected) && time(vehicle.expected.at) && (vehicle.expected.location === null || isTransportLocation(vehicle.expected.location)) &&
      (vehicle.expected.inUse === null || object(vehicle.expected.inUse) && id(vehicle.expected.inUse.bookingId) && isTransportLocation(vehicle.expected.inUse.origin) && isTransportLocation(vehicle.expected.inUse.destination) && time(vehicle.expected.inUse.endsAt)) &&
      (vehicle.nextBooking === null || booking(vehicle.nextBooking)));
}
export function isRidesResponse(value: unknown): value is RidesResponse {
  return object(value) && time(value.now) && value.timeZone === 'Europe/Oslo' && Array.isArray(value.rides) && value.rides.every(ride => object(ride) && id(ride.id) &&
    typeof ride.origin === 'string' && typeof ride.destination === 'string' && time(ride.departureAt) && Number.isInteger(ride.seatCount) && (ride.seatCount as number) >= 1 && (ride.seatCount as number) <= 8 &&
    Number.isInteger(ride.remainingSeats) && (ride.remainingSeats as number) >= 0 && (ride.remainingSeats as number) <= (ride.seatCount as number) &&
    (ride.note === null || typeof ride.note === 'string') && ['OPEN', 'CANCELLED'].includes(ride.status as string) && typeof ride.isDriver === 'boolean' && typeof ride.isJoined === 'boolean');
}
export async function transportRequest(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`/api/transport/${path}`, { method: body === undefined ? 'GET' : 'POST', signal, cache: 'no-store', credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error('Could not reach Transport. Check your connection and try again.');
  }
  const data: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.redirected) throw new Error('Your Access session may have expired. Reload to sign in again.');
  if (!response.ok) throw new Error(object(data) && typeof data.error === 'string' ? data.error : 'Transport could not be loaded. Try again shortly.');
  return data;
}
export async function loadCars(signal?: AbortSignal, at?: string): Promise<CarsResponse> {
  const data = await transportRequest(`vehicles${at ? `?at=${encodeURIComponent(at)}` : ''}`, undefined, signal);
  if (!isCarsResponse(data)) throw new Error('Transport returned an unexpected car response.');
  return data;
}
export async function loadRides(signal?: AbortSignal): Promise<RidesResponse> {
  const data = await transportRequest('rides', undefined, signal);
  if (!isRidesResponse(data)) throw new Error('Transport returned an unexpected ride response.');
  return data;
}
