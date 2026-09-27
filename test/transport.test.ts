import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, testEncryptionKey } from './d1-fixture';
import { resolveApplicationUser, type ApplicationUser } from '../backend/users';
import { getEffectivePermissions } from '../backend/authorization';
import { bookCar, cancelCarBooking, confirmCarBooking, expectedLocation, listCars, reportCarLocation } from '../backend/transport/cars';
import { cancelRide, joinRide, leaveRide, listRides, offerRide } from '../backend/transport/rides';
import { onRequest as vehiclesEndpoint } from '../functions/api/transport/vehicles/index';
import { onRequest as bookingEndpoint } from '../functions/api/transport/bookings/index';
import { onRequest as locationEndpoint } from '../functions/api/transport/vehicles/[id]/location';
import { onRequest as confirmEndpoint } from '../functions/api/transport/bookings/[id]/confirm';
import { onRequest as ridesEndpoint } from '../functions/api/transport/rides/index';
import { onRequest as joinEndpoint } from '../functions/api/transport/rides/[id]/join';
import { onRequest as leaveEndpoint } from '../functions/api/transport/rides/[id]/leave';
import { onRequest as cancelEndpoint } from '../functions/api/transport/bookings/[id]/cancel';
import { onRequest as cancelRideEndpoint } from '../functions/api/transport/rides/[id]/cancel';

const NOW = '2026-09-27T08:00:00.000Z', START = '2026-09-27T09:00:00.000Z', CAR = 'university-car-1';
let fixture: Awaited<ReturnType<typeof createTestDatabase>>, alice: ApplicationUser, bob: ApplicationUser, carol: ApplicationUser;
const db = () => fixture.db;
const carBody = (startsAt = START) => ({ vehicleId: CAR, origin: 'ISTIND', destination: 'UTSA', startsAt });
const rideBody = (seatCount = 1) => ({ origin: 'Istind', destination: 'Airport', departureAt: START, seatCount });
const cars = (at?: string, user = alice) => listCars(db(), user, new Request(`https://portal.test/api/transport/vehicles${at ? `?at=${at}` : ''}`));
async function override(user: ApplicationUser, permission: string, effect: string) {
  await db().prepare('INSERT OR REPLACE INTO user_permission_overrides (user_id, permission_key, effect, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, permission, effect, NOW, NOW).run();
}
async function driver(user = alice) { await override(user, 'transport.offer_private_ride', 'ALLOW'); }
async function ended(user = alice, startsAt = '2026-09-27T07:00:00.000Z', vehicleId = CAR) {
  const id = crypto.randomUUID();
  await db().prepare(`INSERT INTO transport_car_bookings (id, vehicle_id, user_id, origin, destination, starts_at, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, 'ISTIND', 'UTSA', ?, ?, ?, ?)`).bind(id, vehicleId, user.id, startsAt, new Date(Date.parse(startsAt) + 600000).toISOString(), NOW, NOW).run();
  return id;
}
async function endpoint(handler: typeof bookingEndpoint, body?: unknown, options: { actor?: ApplicationUser; anonymous?: boolean; id?: string; method?: string; headers?: Record<string, string>; query?: string } = {}) {
  const actor = options.actor ?? alice;
  const method = options.method ?? (body === undefined ? 'GET' : 'POST');
  return handler({ request: new Request(`https://portal.test/api/transport/resource${options.query ?? ''}`, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), params: { id: options.id ?? CAR },
    env: { DB: db(), FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY: testEncryptionKey },
    data: options.anonymous ? {} : { accessIdentity: { subject: actor.access_subject, email: actor.email } } } as never) as Promise<Response>;
}
beforeAll(async () => { fixture = await createTestDatabase(); });
beforeEach(async () => {
  // Test-only reset of append-only data; production never removes these triggers.
  await db().batch([
    db().prepare('DROP TRIGGER transport_location_events_immutable_delete'),
    db().prepare('DELETE FROM transport_vehicle_location_events'),
    db().prepare("CREATE TRIGGER transport_location_events_immutable_delete BEFORE DELETE ON transport_vehicle_location_events BEGIN SELECT RAISE(ABORT, 'transport_location_history_immutable'); END"),
    ...['transport_private_ride_passengers', 'transport_private_rides', 'transport_car_bookings', 'users'].map(table => db().prepare(`DELETE FROM ${table}`)),
  ]);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  alice = await resolveApplicationUser(db(), { subject: 'alice', email: 'alice@example.test' });
  bob = await resolveApplicationUser(db(), { subject: 'bob', email: 'bob@example.test' });
  carol = await resolveApplicationUser(db(), { subject: 'carol', email: 'carol@example.test' });
});
afterAll(async () => { vi.useRealTimers(); await fixture?.dispose(); });

describe('Transport migration and API boundary', () => {
  it('seeds only two neutral cars with unknown locations and grants booking without driver privileges', async () => {
    const response = await cars();
    expect(response.vehicles.map(car => [car.name, car.reported, car.expected.location])).toEqual([['Car 1', null, null], ['Car 2', null, null]]);
    expect(await getEffectivePermissions(db(), alice)).toEqual(['brakkevakt.swap', 'brakkevakt.view', 'duty_ops.view', 'flyvask.swap', 'flyvask.view', 'transport.book_university_cars', 'transport.view']);
    expect(await db().prepare('SELECT COUNT(*) FROM transport_vehicle_location_events').first('COUNT(*)')).toBe(0);
  });
  it('requires a verified identity and view permission on every endpoint', async () => {
    for (const handler of [vehiclesEndpoint, bookingEndpoint, locationEndpoint, confirmEndpoint, ridesEndpoint, joinEndpoint, leaveEndpoint, cancelEndpoint, cancelRideEndpoint]) {
      const body = handler === vehiclesEndpoint ? undefined : {};
      expect((await endpoint(handler, body, { anonymous: true })).status).toBe(401);
    }
    await override(alice, 'transport.view', 'DENY');
    expect((await endpoint(vehiclesEndpoint)).status).toBe(403);
    expect((await endpoint(bookingEndpoint, carBody())).status).toBe(403);
  });
  it('allows a view-only student to report location but denies car booking and private ride offering', async () => {
    await override(alice, 'transport.book_university_cars', 'DENY');
    expect((await endpoint(locationEndpoint, { location: 'ISTIND' })).status).toBe(200);
    expect((await endpoint(bookingEndpoint, carBody())).status).toBe(403);
    expect((await endpoint(ridesEndpoint, rideBody())).status).toBe(403);
    const event = await db().prepare('SELECT * FROM transport_vehicle_location_events').first();
    expect(event).toMatchObject({ actor_user_id: alice.id, source: 'MANUAL_UPDATE', booking_id: null });
  });
  it('uses JSON, same-origin, no-store and strict fields; identity, duration and source cannot be forged', async () => {
    for (const field of ['userId', 'endsAt', 'status', 'confirmedAt']) expect((await endpoint(bookingEndpoint, { ...carBody(), [field]: 'forged' })).status).toBe(400);
    expect((await endpoint(locationEndpoint, { location: 'UTSA', source: 'TRIP_CONFIRMATION' })).status).toBe(400);
    expect((await endpoint(locationEndpoint, { location: 'UTSA' }, { headers: { Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await endpoint(locationEndpoint, { location: 'UTSA' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await endpoint(locationEndpoint, { location: 'UTSA' }, { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await endpoint(locationEndpoint, { location: 'UTSA' }, { query: '?user=bob' })).status).toBe(400);
    expect((await endpoint(vehiclesEndpoint, undefined, { query: '?extra=1' })).status).toBe(400);
    expect((await endpoint(vehiclesEndpoint, undefined, { query: `?at=${START}&at=${START}` })).status).toBe(400);
    expect((await endpoint(locationEndpoint, { location: 'x'.repeat(5000) })).status).toBe(413);
    expect((await endpoint(bookingEndpoint, undefined)).status).toBe(405);
    const response = await endpoint(vehiclesEndpoint);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(JSON.stringify(await response.json())).not.toMatch(/email|access_subject|token|ciphertext|user_id/);
  });
  it('rejects malformed, past, noncanonical and unsupported inputs', async () => {
    for (const startsAt of [NOW, '2026-09-27T09:00:00+00:00', '2026-02-30T09:00:00.000Z', '2028-01-01T09:00:00.000Z']) {
      expect((await endpoint(bookingEndpoint, { ...carBody(), startsAt })).status).toBe(400);
    }
    expect((await endpoint(bookingEndpoint, { ...carBody(), destination: 'ISTIND' })).status).toBe(400);
    expect((await endpoint(bookingEndpoint, { ...carBody(), origin: 'AIRPORT' })).status).toBe(400);
    expect((await endpoint(bookingEndpoint, { ...carBody(), vehicleId: 'missing' })).status).toBe(404);
  });
});

describe('car booking integrity', () => {
  it('derives exactly ten minutes and treats location mismatch as advisory', async () => {
    await reportCarLocation(db(), alice, CAR, { location: 'NAERINGSHAGEN' });
    const booking = await bookCar(db(), alice, carBody());
    expect(booking).toMatchObject({ origin: 'ISTIND', endsAt: '2026-09-27T09:10:00.000Z', status: 'BOOKED', confirmedAt: null, isMine: true });
    expect((await cars()).vehicles[0].reported?.location).toBe('NAERINGSHAGEN');
  });
  it('rejects every overlap, accepts adjacent trips and permits simultaneous trips in different cars', async () => {
    await bookCar(db(), alice, carBody());
    for (const time of ['08:55', '09:00', '09:05']) await expect(bookCar(db(), bob, carBody(`2026-09-27T${time}:00.000Z`))).rejects.toMatchObject({ status: 409, code: 'CAR_BOOKING_CONFLICT' });
    await expect(bookCar(db(), bob, carBody('2026-09-27T09:10:00.000Z'))).resolves.toMatchObject({ status: 'BOOKED' });
    await expect(bookCar(db(), bob, { ...carBody(), vehicleId: 'university-car-2' })).resolves.toMatchObject({ status: 'BOOKED' });
  });
  it('allows exactly one concurrent booking for the same car and interval', async () => {
    const attempts = await Promise.allSettled([bookCar(db(), alice, carBody()), bookCar(db(), bob, carBody())]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'CAR_BOOKING_CONFLICT' } });
  });
  it('lets only the owner cancel a future or active trip and frees the interval', async () => {
    const booking = await bookCar(db(), alice, carBody());
    await expect(cancelCarBooking(db(), bob, booking.id)).rejects.toMatchObject({ status: 403 });
    vi.setSystemTime('2026-09-27T09:05:00.000Z');
    expect((await cancelCarBooking(db(), alice, booking.id)).status).toBe('CANCELLED');
    vi.setSystemTime(NOW);
    await expect(bookCar(db(), bob, carBody())).resolves.toMatchObject({ status: 'BOOKED' });
    expect((await cars()).bookings).toHaveLength(1);
  });
  it('does not cancel ended trips or reconfirm cancelled trips', async () => {
    const past = await ended();
    await expect(cancelCarBooking(db(), alice, past)).rejects.toMatchObject({ status: 409 });
    const future = await bookCar(db(), alice, carBody());
    await cancelCarBooking(db(), alice, future.id); vi.setSystemTime('2026-09-27T10:00:00.000Z');
    await expect(confirmCarBooking(db(), alice, future.id, { asPlanned: true })).rejects.toMatchObject({ status: 409 });
  });
  it('requires booking permission to cancel, while confirmation stays available to an owner with view access', async () => {
    const booking = await bookCar(db(), alice, carBody());
    const past = await ended();
    await override(alice, 'transport.book_university_cars', 'DENY');
    await expect(cancelCarBooking(db(), alice, booking.id)).rejects.toMatchObject({ status: 403 });
    await expect(confirmCarBooking(db(), alice, past, { asPlanned: true })).resolves.toMatchObject({ confirmedAt: NOW });
  });
});

describe('reported locations, projections and confirmations', () => {
  it('projects bookings from the latest report, ignores cancellations, and handles half-open active intervals', () => {
    const report = { location: 'ISTIND' as const, created_at: NOW };
    const trip = { id: 'trip', origin: 'ISTIND' as const, destination: 'UTSA' as const, starts_at: START, ends_at: '2026-09-27T09:10:00.000Z', status: 'BOOKED' as const };
    expect(expectedLocation(NOW, report, [trip])).toMatchObject({ location: 'ISTIND', inUse: null });
    expect(expectedLocation(START, report, [trip]).inUse?.destination).toBe('UTSA');
    expect(expectedLocation(trip.ends_at, report, [trip])).toMatchObject({ location: 'UTSA', inUse: null });
    expect(expectedLocation(trip.ends_at, report, [{ ...trip, status: 'CANCELLED' }]).location).toBe('ISTIND');
    expect(expectedLocation('2026-09-27T10:00:00.000Z', { location: 'NAERINGSHAGEN', created_at: '2026-09-27T09:30:00.000Z' }, [trip]).location).toBe('NAERINGSHAGEN');
    expect(expectedLocation(trip.ends_at, null, [trip]).location).toBe('UTSA');
  });
  it('keeps reported and expected separate, with a later report resetting projected location', async () => {
    const id = await ended();
    expect((await cars()).vehicles[0]).toMatchObject({ reported: null, expected: { location: 'UTSA' } });
    await reportCarLocation(db(), bob, CAR, { location: 'NAERINGSHAGEN' });
    const current = await cars();
    expect(current.vehicles[0]).toMatchObject({ reported: { location: 'NAERINGSHAGEN', reportedAt: NOW }, expected: { location: 'NAERINGSHAGEN' } });
    expect(current.pendingConfirmations.map(row => row.id)).toEqual([id]);
  });
  it('lists only own ended unconfirmed trips, oldest first, without blocking future bookings', async () => {
    const first = await ended(alice, '2026-09-27T06:00:00.000Z');
    const second = await ended(); await ended(bob, '2026-09-27T07:20:00.000Z');
    await bookCar(db(), alice, carBody());
    expect((await cars()).pendingConfirmations.map(row => row.id)).toEqual([first, second]);
    expect((await cars(undefined, bob)).pendingConfirmations).toHaveLength(1);
  });
  it.each([true, false])('atomically confirms an ended own trip with asPlanned=%s and records the correct source', async asPlanned => {
    const id = await ended();
    const booking = await confirmCarBooking(db(), alice, id, asPlanned ? { asPlanned: true } : { asPlanned: false, location: 'NAERINGSHAGEN' });
    expect(booking).toMatchObject({ status: 'BOOKED', confirmedAt: NOW });
    expect(await db().prepare('SELECT * FROM transport_vehicle_location_events WHERE booking_id = ?').bind(id).first()).toMatchObject({ actor_user_id: alice.id,
      location: asPlanned ? 'UTSA' : 'NAERINGSHAGEN', source: asPlanned ? 'TRIP_CONFIRMATION' : 'TRIP_CORRECTION', created_at: NOW });
    expect((await cars()).pendingConfirmations).toHaveLength(0);
    await expect(confirmCarBooking(db(), alice, id, { asPlanned: true })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects confirmation before the end, by another user, and with incompatible shapes', async () => {
    const future = await bookCar(db(), alice, carBody());
    await expect(confirmCarBooking(db(), alice, future.id, { asPlanned: true })).rejects.toMatchObject({ status: 409 });
    const past = await ended();
    await expect(confirmCarBooking(db(), bob, past, { asPlanned: true })).rejects.toMatchObject({ status: 403 });
    for (const body of [{ asPlanned: true, location: 'UTSA' }, { asPlanned: false }, { asPlanned: 'yes' }]) expect((await endpoint(confirmEndpoint, body, { id: past })).status).toBe(400);
  });
  it('rolls back confirmation if its location event cannot be written', async () => {
    const id = await ended();
    await db().prepare("CREATE TRIGGER reject_test_confirmation BEFORE INSERT ON transport_vehicle_location_events WHEN NEW.source <> 'MANUAL_UPDATE' BEGIN SELECT RAISE(ABORT, 'test_failure'); END").run();
    try {
      await expect(confirmCarBooking(db(), alice, id, { asPlanned: true })).rejects.toThrow();
      expect(await db().prepare('SELECT confirmed_at FROM transport_car_bookings WHERE id = ?').bind(id).first('confirmed_at')).toBeNull();
      expect((await cars()).pendingConfirmations).toHaveLength(1);
    } finally { await db().prepare('DROP TRIGGER reject_test_confirmation').run(); }
  });
  it('keeps history immutable and deterministically orders tied reports, including later confirmation', async () => {
    const id = await ended();
    await reportCarLocation(db(), bob, CAR, { location: 'ISTIND' });
    await reportCarLocation(db(), carol, CAR, { location: 'NAERINGSHAGEN' });
    expect((await cars()).vehicles[0].reported?.location).toBe('NAERINGSHAGEN');
    await expect(db().prepare("UPDATE transport_vehicle_location_events SET location = 'UTSA'").run()).rejects.toThrow(/transport_location_history_immutable/);
    await expect(db().prepare('DELETE FROM transport_vehicle_location_events').run()).rejects.toThrow(/transport_location_history_immutable/);
    vi.setSystemTime('2026-09-27T08:01:00.000Z');
    await confirmCarBooking(db(), alice, id, { asPlanned: true });
    expect((await cars()).vehicles[0].reported).toEqual({ location: 'UTSA', reportedAt: '2026-09-27T08:01:00.000Z' });
    expect(await db().prepare('SELECT COUNT(*) FROM transport_vehicle_location_events').first('COUNT(*)')).toBe(3);
  });
  it('allows only one concurrent confirmation and one location event', async () => {
    const id = await ended();
    const results = await Promise.allSettled([confirmCarBooking(db(), alice, id, { asPlanned: true }), confirmCarBooking(db(), alice, id, { asPlanned: false, location: 'ISTIND' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db().prepare('SELECT COUNT(*) FROM transport_vehicle_location_events WHERE booking_id = ?').bind(id).first('COUNT(*)')).toBe(1);
  });
});

describe('private rides and passenger capacity', () => {
  it.each([
    ['driver', 'transport_driver_cannot_join'],
    ['cancelled', 'transport_ride_unavailable'],
    ['departed', 'transport_ride_unavailable'],
    ['full', 'transport_ride_full'],
  ])('enforces passenger integrity for direct database writes: %s', async (scenario, error) => {
    await driver(); const ride = await offerRide(db(), alice, rideBody());
    if (scenario === 'cancelled') await db().prepare("UPDATE transport_private_rides SET status = 'CANCELLED' WHERE id = ?").bind(ride.id).run();
    if (scenario === 'departed') await db().prepare('UPDATE transport_private_rides SET departure_at = ? WHERE id = ?').bind(NOW, ride.id).run();
    if (scenario === 'full') await joinRide(db(), carol, ride.id);
    await expect(db().prepare('INSERT INTO transport_private_ride_passengers (ride_id, user_id, joined_at) VALUES (?, ?, ?)')
      .bind(ride.id, scenario === 'driver' ? alice.id : bob.id, NOW).run()).rejects.toThrow(error);
    expect(await db().prepare('SELECT COUNT(*) FROM transport_private_ride_passengers WHERE ride_id = ?')
      .bind(ride.id).first('COUNT(*)')).toBe(scenario === 'full' ? 1 : 0);
  });
  it('needs opt-in offering permission, stores passenger seats and excludes the driver', async () => {
    await expect(offerRide(db(), alice, rideBody())).rejects.toMatchObject({ status: 403 });
    await driver(); const ride = await offerRide(db(), alice, { ...rideBody(2), note: ' Meet outside ' });
    expect(ride).toMatchObject({ seatCount: 2, remainingSeats: 2, isDriver: true, isJoined: false, note: 'Meet outside' });
    expect(await db().prepare('SELECT COUNT(*) FROM transport_private_ride_passengers').first('COUNT(*)')).toBe(0);
    const response = await listRides(db(), bob, new Request('https://portal.test/api/transport/rides'));
    expect(response.rides[0].isDriver).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(/email|user_id|token/);
  });
  it('lets view-only users join and leave, releasing a seat', async () => {
    await driver(); const ride = await offerRide(db(), alice, rideBody());
    await override(bob, 'transport.book_university_cars', 'DENY');
    expect((await endpoint(joinEndpoint, {}, { actor: bob, id: ride.id })).status).toBe(200);
    expect((await leaveRide(db(), bob, ride.id)).remainingSeats).toBe(1);
    expect((await joinRide(db(), carol, ride.id)).remainingSeats).toBe(0);
  });
  it('allows exactly one concurrent claim on the last seat', async () => {
    await driver(); const ride = await offerRide(db(), alice, rideBody());
    const attempts = await Promise.allSettled([joinRide(db(), bob, ride.id), joinRide(db(), carol, ride.id)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'RIDE_FULL' } });
    expect(await db().prepare('SELECT COUNT(*) FROM transport_private_ride_passengers WHERE ride_id = ?').bind(ride.id).first('COUNT(*)')).toBe(1);
  });
  it('rejects driver self-join and duplicate passengers without consuming another seat', async () => {
    await driver(); const ride = await offerRide(db(), alice, rideBody(2));
    await expect(joinRide(db(), alice, ride.id)).rejects.toMatchObject({ code: 'DRIVER_CANNOT_JOIN' });
    await joinRide(db(), bob, ride.id);
    await expect(joinRide(db(), bob, ride.id)).rejects.toMatchObject({ code: 'ALREADY_JOINED' });
    expect((await joinRide(db(), carol, ride.id)).remainingSeats).toBe(0);
  });
  it('allows only the driver with offering permission to cancel own future rides; passengers retain cancelled state', async () => {
    await driver(); await driver(bob); const ride = await offerRide(db(), alice, rideBody());
    await joinRide(db(), carol, ride.id);
    await expect(cancelRide(db(), bob, ride.id)).rejects.toMatchObject({ status: 403 });
    expect((await cancelRide(db(), alice, ride.id)).status).toBe('CANCELLED');
    await expect(joinRide(db(), bob, ride.id)).rejects.toMatchObject({ code: 'RIDE_UNAVAILABLE' });
    expect((await listRides(db(), carol, new Request('https://portal.test/api/transport/rides'))).rides[0]).toMatchObject({ status: 'CANCELLED', isJoined: true });
    expect((await leaveRide(db(), carol, ride.id)).remainingSeats).toBe(1);
  });
  it('cannot join, leave or cancel after departure and cannot leave someone else’s seat', async () => {
    await driver(); const ride = await offerRide(db(), alice, rideBody(2)); await joinRide(db(), bob, ride.id);
    await expect(leaveRide(db(), carol, ride.id)).rejects.toMatchObject({ status: 409 });
    expect((await endpoint(leaveEndpoint, { userId: bob.id }, { actor: carol, id: ride.id })).status).toBe(400);
    vi.setSystemTime(START);
    await expect(joinRide(db(), carol, ride.id)).rejects.toMatchObject({ code: 'RIDE_UNAVAILABLE' });
    await expect(leaveRide(db(), bob, ride.id)).rejects.toMatchObject({ status: 409 });
    await expect(cancelRide(db(), alice, ride.id)).rejects.toMatchObject({ status: 409 });
    expect((await listRides(db(), bob, new Request('https://portal.test/api/transport/rides'))).rides).toHaveLength(0);
  });
  it('rejects invalid capacity, text, time and forged driver identity', async () => {
    await driver();
    for (const seatCount of [0, 9, 1.5, '2']) expect((await endpoint(ridesEndpoint, { ...rideBody(), seatCount })).status).toBe(400);
    for (const origin of ['', 'x'.repeat(81), 'unsafe\ntext']) expect((await endpoint(ridesEndpoint, { ...rideBody(), origin })).status).toBe(400);
    expect((await endpoint(ridesEndpoint, { ...rideBody(), note: 'x'.repeat(281) })).status).toBe(400);
    expect((await endpoint(ridesEndpoint, { ...rideBody(), departureAt: NOW })).status).toBe(400);
    expect((await endpoint(ridesEndpoint, { ...rideBody(), driverUserId: bob.id })).status).toBe(400);
  });
  it('re-checks revoked permissions inside writes', async () => {
    await driver(); const ride = await offerRide(db(), alice, rideBody());
    await override(bob, 'transport.view', 'DENY');
    await expect(joinRide(db(), bob, ride.id)).rejects.toMatchObject({ status: 409 });
    await expect(reportCarLocation(db(), bob, CAR, { location: 'UTSA' })).rejects.toMatchObject({ status: 409 });
    expect(await db().prepare('SELECT COUNT(*) FROM transport_private_ride_passengers').first('COUNT(*)')).toBe(0);
  });
});
