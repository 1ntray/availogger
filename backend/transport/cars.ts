import { ApplicationError } from '../application-error';
import { requirePermission } from '../authorization';
import type { ApplicationUser } from '../users';
import { PERMISSIONS } from '../../shared/authorization';
import { CAR_TRIP_MINUTES, type CarBooking, type CarsResponse, type ExpectedCarLocation, type TransportLocation } from '../../shared/transport';
import { canonicalTime, futureTime, invalid, location, resourceId } from './request';
import { permissionCondition, ensureChanged, translateConstraint } from './storage';

type BookingRow = { id: string; vehicle_id: string; user_id: string; origin: TransportLocation; destination: TransportLocation;
  starts_at: string; ends_at: string; status: 'BOOKED' | 'CANCELLED'; confirmed_at: string | null };
type LocationRow = { vehicle_id: string; location: TransportLocation; created_at: string; sequence: number };
const publicBooking = (row: BookingRow, userId: string): CarBooking => ({ id: row.id, vehicleId: row.vehicle_id,
  origin: row.origin, destination: row.destination, startsAt: row.starts_at, endsAt: row.ends_at,
  status: row.status, confirmedAt: row.confirmed_at, isMine: row.user_id === userId });

// A report resets the baseline. Only trips ending after that report can project it forward.
export function expectedLocation(at: string, report: { location: TransportLocation; created_at: string } | null,
  bookings: Pick<BookingRow, 'id' | 'origin' | 'destination' | 'starts_at' | 'ends_at' | 'status'>[]): ExpectedCarLocation {
  const eligible = bookings.filter(row => row.status === 'BOOKED');
  const latest = eligible.filter(row => row.ends_at <= at && (!report || row.ends_at > report.created_at))
    .sort((a, b) => b.ends_at.localeCompare(a.ends_at))[0];
  const active = eligible.find(row => row.starts_at <= at && row.ends_at > at);
  return { at, location: latest?.destination ?? report?.location ?? null,
    inUse: active ? { bookingId: active.id, origin: active.origin, destination: active.destination, endsAt: active.ends_at } : null };
}

export async function listCars(db: D1Database, user: ApplicationUser, request: Request): Promise<CarsResponse> {
  const now = new Date().toISOString();
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== 'at') || query.getAll('at').length > 1) invalid();
  const at = query.has('at') ? canonicalTime(query.get('at')) : now;
  if (Date.parse(now) - Date.parse(at) > 60000 || Date.parse(at) - Date.parse(now) > 366 * 86400000) invalid('Choose a time within one year.');
  const vehicles = await db.prepare('SELECT id, name FROM transport_vehicles ORDER BY id').all<{ id: string; name: string }>();
  // One snapshot keeps reports, projected trips and confirmation state consistent.
  const [bookingResult, reports] = await db.batch<BookingRow | LocationRow>([
    db.prepare(`SELECT id, vehicle_id, user_id, origin, destination, starts_at, ends_at, status, confirmed_at FROM transport_car_bookings
      WHERE status = 'BOOKED' ORDER BY starts_at, id`),
    db.prepare(`SELECT vehicle_id, location, created_at, sequence FROM transport_vehicle_location_events
      WHERE created_at <= ? ORDER BY created_at DESC, sequence DESC`).bind(at > now ? at : now),
  ]);
  const rows = bookingResult.results as BookingRow[];
  const events = reports.results as LocationRow[];
  return { now, timeZone: 'Europe/Oslo', vehicles: vehicles.results.map(vehicle => {
    const reported = events.find(event => event.vehicle_id === vehicle.id && event.created_at <= now);
    const baseline = events.find(event => event.vehicle_id === vehicle.id && event.created_at <= at) ?? null;
    const trips = rows.filter(row => row.vehicle_id === vehicle.id);
    const next = trips.find(row => row.starts_at > now);
    return { ...vehicle, reported: reported ? { location: reported.location, reportedAt: reported.created_at } : null,
      expected: expectedLocation(at, baseline, trips), nextBooking: next ? publicBooking(next, user.id) : null };
  }), bookings: rows.filter(row => row.ends_at > now).map(row => publicBooking(row, user.id)),
  pendingConfirmations: rows.filter(row => row.user_id === user.id && row.ends_at <= now && !row.confirmed_at).map(row => publicBooking(row, user.id)) };
}

async function getBooking(db: D1Database, id: unknown): Promise<BookingRow> {
  const row = await db.prepare('SELECT * FROM transport_car_bookings WHERE id = ?').bind(resourceId(id)).first<BookingRow>();
  if (!row) throw new ApplicationError('Car booking not found.', 404, 'NOT_FOUND');
  return row;
}
function ownBooking(row: BookingRow, user: ApplicationUser) {
  if (row.user_id !== user.id) throw new ApplicationError('You can change only your own booking.', 403, 'FORBIDDEN');
}
export async function bookCar(db: D1Database, user: ApplicationUser, body: Record<string, unknown>): Promise<CarBooking> {
  await requirePermission(db, user, PERMISSIONS.transportBookUniversityCars);
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const vehicleId = resourceId(body.vehicleId), origin = location(body.origin), destination = location(body.destination);
  const startsAt = futureTime(body.startsAt, now), endsAt = new Date(Date.parse(startsAt) + CAR_TRIP_MINUTES * 60000).toISOString();
  if (origin === destination) invalid('Choose a different destination.');
  if (!await db.prepare('SELECT 1 FROM transport_vehicles WHERE id = ?').bind(vehicleId).first()) throw new ApplicationError('Car not found.', 404, 'NOT_FOUND');
  try {
    const result = await db.prepare(`INSERT INTO transport_car_bookings
      (id, vehicle_id, user_id, origin, destination, starts_at, ends_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${permissionCondition(true)}`)
      .bind(id, vehicleId, user.id, origin, destination, startsAt, endsAt, now, now, user.id, user.id).run();
    ensureChanged(result);
  } catch (error) { translateConstraint(error); }
  return publicBooking(await getBooking(db, id), user.id);
}

export async function cancelCarBooking(db: D1Database, user: ApplicationUser, id: unknown): Promise<CarBooking> {
  await requirePermission(db, user, PERMISSIONS.transportBookUniversityCars);
  const row = await getBooking(db, id); ownBooking(row, user);
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE transport_car_bookings SET status = 'CANCELLED', updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'BOOKED' AND confirmed_at IS NULL AND ends_at > ? AND ${permissionCondition(true)}`)
    .bind(now, row.id, user.id, now, user.id, user.id).run();
  ensureChanged(result, 'This booking can no longer be cancelled.');
  return publicBooking(await getBooking(db, row.id), user.id);
}

export async function reportCarLocation(db: D1Database, user: ApplicationUser, vehicleId: unknown, body: Record<string, unknown>) {
  const id = resourceId(vehicleId), chosen = location(body.location), now = new Date().toISOString();
  if (!await db.prepare('SELECT 1 FROM transport_vehicles WHERE id = ?').bind(id).first()) throw new ApplicationError('Car not found.', 404, 'NOT_FOUND');
  const result = await db.prepare(`INSERT INTO transport_vehicle_location_events (id, vehicle_id, location, actor_user_id, source, created_at)
    SELECT ?, ?, ?, ?, 'MANUAL_UPDATE', ? WHERE ${permissionCondition()}`)
    .bind(crypto.randomUUID(), id, chosen, user.id, now, user.id).run();
  ensureChanged(result);
  return { vehicleId: id, location: chosen, reportedAt: now };
}

export async function confirmCarBooking(db: D1Database, user: ApplicationUser, id: unknown, body: Record<string, unknown>): Promise<CarBooking> {
  const row = await getBooking(db, id); ownBooking(row, user);
  if (typeof body.asPlanned !== 'boolean' || (body.asPlanned && Object.hasOwn(body, 'location')) || (!body.asPlanned && !Object.hasOwn(body, 'location'))) invalid();
  const chosen = body.asPlanned ? row.destination : location(body.location);
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(`UPDATE transport_car_bookings SET confirmed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'BOOKED' AND ends_at <= ? AND confirmed_at IS NULL AND ${permissionCondition()}`)
      .bind(now, now, row.id, user.id, now, user.id),
    db.prepare(`INSERT INTO transport_vehicle_location_events (id, vehicle_id, location, actor_user_id, booking_id, source, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), row.vehicle_id, chosen, user.id, row.id, body.asPlanned ? 'TRIP_CONFIRMATION' : 'TRIP_CORRECTION', now),
  ]);
  ensureChanged(result[0], 'This booking is not awaiting confirmation.');
  return publicBooking(await getBooking(db, row.id), user.id);
}
