import { ApplicationError } from '../application-error';
import type { PermissionKey } from '../../shared/authorization';

// Re-check permissions inside the write, so a concurrent revocation cannot race the preflight check.
export function permissionCondition(book = false, offer = false): string {
  const has = (key: PermissionKey) => `EXISTS (SELECT 1 FROM effective_user_permissions WHERE user_id = ? AND permission_key = '${key}')`;
  return has('transport.view') + (book ? ` AND ${has('transport.book_university_cars')}` : '') + (offer ? ` AND ${has('transport.offer_private_ride')}` : '');
}
export function ensureChanged(result: D1Result, message = 'Your access or the Transport resource has changed. Reload and try again.') {
  if (!result.meta.changes) throw new ApplicationError(message, 409, 'TRANSPORT_CHANGED');
}
export function translateConstraint(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const known = [
    ['transport_booking_overlap', 'Another booking overlaps this time. Choose another departure or car.', 'CAR_BOOKING_CONFLICT'],
    ['transport_driver_cannot_join', 'The driver cannot join as a passenger.', 'DRIVER_CANNOT_JOIN'],
    ['transport_ride_unavailable', 'This ride is no longer available.', 'RIDE_UNAVAILABLE'],
    ['transport_ride_full', 'The last seat has been taken. Reload the rides.', 'RIDE_FULL'],
    ['UNIQUE constraint failed: transport_private_ride_passengers', 'You have already joined this ride.', 'ALREADY_JOINED'],
  ];
  const match = known.find(([needle]) => message.includes(needle));
  if (match) throw new ApplicationError(match[1], 409, match[2]);
  throw error;
}
