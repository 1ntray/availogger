import { ApplicationError } from '../application-error';
import { requirePermission } from '../authorization';
import type { ApplicationUser } from '../users';
import { PERMISSIONS } from '../../shared/authorization';
import type { PrivateRide, RidesResponse } from '../../shared/transport';
import { futureTime, resourceId, rideText, seatCount, invalid } from './request';
import { permissionCondition, ensureChanged, translateConstraint } from './storage';

type RideRow = { id: string; driver_user_id: string; origin: string; destination: string; departure_at: string; seat_count: number;
  note: string | null; status: 'OPEN' | 'CANCELLED'; passenger_count: number; joined: number };
const query = `SELECT r.*, (SELECT COUNT(*) FROM transport_private_ride_passengers WHERE ride_id = r.id) AS passenger_count,
  EXISTS(SELECT 1 FROM transport_private_ride_passengers WHERE ride_id = r.id AND user_id = ?) AS joined FROM transport_private_rides r`;
const publicRide = (row: RideRow, userId: string): PrivateRide => ({ id: row.id, origin: row.origin, destination: row.destination,
  departureAt: row.departure_at, seatCount: row.seat_count, remainingSeats: row.seat_count - row.passenger_count, note: row.note,
  status: row.status, isDriver: row.driver_user_id === userId, isJoined: !!row.joined });
async function getRide(db: D1Database, user: ApplicationUser, id: unknown): Promise<RideRow> {
  const row = await db.prepare(`${query} WHERE r.id = ?`).bind(user.id, resourceId(id)).first<RideRow>();
  if (!row) throw new ApplicationError('Private ride not found.', 404, 'NOT_FOUND');
  return row;
}
export async function listRides(db: D1Database, user: ApplicationUser, request: Request): Promise<RidesResponse> {
  if (new URL(request.url).search) invalid();
  const now = new Date().toISOString();
  const result = await db.prepare(`${query} WHERE r.departure_at > ? AND (r.status = 'OPEN' OR r.driver_user_id = ?
    OR EXISTS(SELECT 1 FROM transport_private_ride_passengers WHERE ride_id = r.id AND user_id = ?)) ORDER BY r.departure_at, r.id`)
    .bind(user.id, now, user.id, user.id).all<RideRow>();
  return { now, timeZone: 'Europe/Oslo', rides: result.results.map(row => publicRide(row, user.id)) };
}
export async function offerRide(db: D1Database, user: ApplicationUser, body: Record<string, unknown>): Promise<PrivateRide> {
  await requirePermission(db, user, PERMISSIONS.transportOfferPrivateRide);
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const origin = rideText(body.origin), destination = rideText(body.destination);
  const departureAt = futureTime(body.departureAt, now), seats = seatCount(body.seatCount);
  const note = body.note === undefined || body.note === null || body.note === '' ? null : rideText(body.note, 280);
  const result = await db.prepare(`INSERT INTO transport_private_rides
    (id, driver_user_id, origin, destination, departure_at, seat_count, note, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${permissionCondition(false, true)}`)
    .bind(id, user.id, origin, destination, departureAt, seats, note, now, now, user.id, user.id).run();
  ensureChanged(result);
  return publicRide(await getRide(db, user, id), user.id);
}
export async function joinRide(db: D1Database, user: ApplicationUser, id: unknown): Promise<PrivateRide> {
  const row = await getRide(db, user, id), now = new Date().toISOString();
  try {
    const result = await db.prepare(`INSERT INTO transport_private_ride_passengers (ride_id, user_id, joined_at)
      SELECT ?, ?, ? WHERE ${permissionCondition()}`)
      .bind(row.id, user.id, now, user.id).run();
    ensureChanged(result);
  } catch (error) { translateConstraint(error); }
  return publicRide(await getRide(db, user, row.id), user.id);
}
export async function leaveRide(db: D1Database, user: ApplicationUser, id: unknown): Promise<PrivateRide> {
  const row = await getRide(db, user, id), now = new Date().toISOString();
  const result = await db.prepare(`DELETE FROM transport_private_ride_passengers WHERE ride_id = ? AND user_id = ?
    AND EXISTS(SELECT 1 FROM transport_private_rides WHERE id = ? AND departure_at > ?) AND ${permissionCondition()}`)
    .bind(row.id, user.id, row.id, now, user.id).run();
  ensureChanged(result, 'You are not a passenger on this future ride.');
  return publicRide(await getRide(db, user, row.id), user.id);
}
export async function cancelRide(db: D1Database, user: ApplicationUser, id: unknown): Promise<PrivateRide> {
  await requirePermission(db, user, PERMISSIONS.transportOfferPrivateRide);
  const row = await getRide(db, user, id), now = new Date().toISOString();
  if (row.driver_user_id !== user.id) throw new ApplicationError('You can cancel only your own ride.', 403, 'FORBIDDEN');
  const result = await db.prepare(`UPDATE transport_private_rides SET status = 'CANCELLED', updated_at = ?
    WHERE id = ? AND driver_user_id = ? AND status = 'OPEN' AND departure_at > ? AND ${permissionCondition(false, true)}`)
    .bind(now, row.id, user.id, now, user.id, user.id).run();
  ensureChanged(result, 'This ride can no longer be cancelled.');
  return publicRide(await getRide(db, user, row.id), user.id);
}
