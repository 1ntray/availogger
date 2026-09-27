# Transport core

Transport separates shared university cars from private ride offers. It uses the existing Access identity, application user and D1 permissions, with same-origin JSON APIs. It makes no FlightLogger calls and has no GPS integration.

## University cars

Migration `0005_transport.sql` creates `transport_vehicles`, `transport_car_bookings` and `transport_vehicle_location_events`. It seeds exactly **Car 1** and **Car 2**, with neutral IDs and no registration or initial physical location. Fixed locations are `ISTIND` (Istind), `UTSA` (UTSA) and `NAERINGSHAGEN` (Næringshagen).

A booking belongs to its authenticated application user and records the car, origin, destination, departure, derived arrival, `BOOKED`/`CANCELLED` status, nullable confirmation time and creation/update timestamps. The server derives arrival as departure **plus ten minutes**. Origins and destinations must differ. Departures must be future canonical UTC timestamps within 366 days. All dates are presented in **Europe/Oslo**, including an explicit first/second occurrence selector for the autumn repeated hour; nonexistent spring-transition times are rejected.

Overlapping time is the only hard scheduling conflict: `existing.starts_at < new.ends_at AND existing.ends_at > new.starts_at`. Cancelled bookings do not reserve time, and adjacent bookings are allowed. SQLite insert/update triggers run under D1's write serialization, so simultaneous overlapping requests cannot both succeed. Conflict responses are safe HTTP 409 messages.

The owner with booking permission may cancel a booking while it remains `BOOKED`, unconfirmed and has not ended, including an active trip. Ended bookings remain available for confirmation rather than cancellation.

## Reported and expected location

**Reported** location is an explicit observation, never GPS. Initially it is unknown. Any user with `transport.view` can use **Change location**, regardless of bookings or driver/admin status. The server appends a `MANUAL_UPDATE` event identifying the actor and time; it never confirms another user's trip.

**Expected** location is advisory. At requested time T, find the latest report at/before T. Starting with that report, find noncancelled bookings ending after the report and at/before T. The latest applicable booking's destination becomes expected location; otherwise retain the report. With no report, an elapsed booking may project its destination, but reported location remains unknown. Active trips use half-open intervals and show their origin, destination and expected arrival. Event sequence resolves equal timestamps deterministically.

A newer report resets the projection baseline. An origin that differs from expected location is allowed without a checkbox, extra confirmation, red validation error or backend location constraint. The expected origin is a default the user can edit; the portal does not know every unbooked movement.

## Trip confirmation and history

The page lists the current user's ended, unconfirmed `BOOKED` trips oldest first in a nonblocking area. **Yes, at destination** confirms the trip and appends `TRIP_CONFIRMATION`; **Another location** selects a fixed location and appends `TRIP_CORRECTION`. Confirmation time and event are written in one D1 batch transaction. Failed event insertion rolls back the confirmation, and simultaneous/double confirmation produces only one event.

Location history stores a unique event ID, insertion sequence, car, fixed location, authenticated actor, optional booking ID, server-controlled source and UTC creation time. Events cannot be updated/deleted; each booking has at most one confirmation event. No arbitrary notes or request bodies are stored in location history. A later confirmation is a new report at confirmation time, even if someone manually reported a different location earlier. It is an observation, not a rewrite of old history. The event log is authoritative; there is no denormalized current-location column.

## Private rides

`transport_private_rides` stores the driver, free-text origin/destination (80 characters each), future UTC departure, 1–8 **passenger seats excluding the driver**, optional note (280 characters), status and timestamps. `transport_private_ride_passengers` stores ride/user membership and join time. Users with view permission browse, join and leave their own future ride membership. Offering and cancelling one's own future ride additionally require `transport.offer_private_ride`.

A compound primary key prevents duplicate passengers. An insert trigger rejects the driver as passenger, past/cancelled rides and exhausted capacity. Counting and inserting run within D1's serialized write, so only one simultaneous request can claim the last seat. Leaving frees a seat. Cancellation retains passenger records and remains visible to the driver/passengers until departure. A join racing cancellation either commits before cancellation or rejects after it; cancelled rides accept no new passengers.

## Permissions and API

Migration 0005 explicitly grants new `transport.book_university_cars` to both STUDENT and ADMIN. Existing `transport.view` remains the module boundary. Students do **not** receive private ride offering by default. Existing `transport.manage_university_cars` stays privileged and is unused by these ordinary user flows. Explicit DENY overrides continue to take precedence. Mutation statements also check effective permissions inside their write to close revocation races.

| Endpoint | Method | Body / additional permission |
| --- | --- | --- |
| `/api/transport/vehicles` | GET | Optional `at` canonical UTC forecast time; current time by default |
| `/api/transport/vehicles/:id/location` | POST | `{location}` |
| `/api/transport/bookings` | POST | `{vehicleId, origin, destination, startsAt}`; book permission |
| `/api/transport/bookings/:id/cancel` | POST | `{}`; owner and book permission |
| `/api/transport/bookings/:id/confirm` | POST | `{asPlanned:true}` or `{asPlanned:false, location}`; owner |
| `/api/transport/rides` | GET | Upcoming open rides and own/joined cancelled rides |
| `/api/transport/rides` | POST | `{origin, destination, departureAt, seatCount, note?}`; offer permission |
| `/api/transport/rides/:id/join` | POST | `{}` |
| `/api/transport/rides/:id/leave` | POST | `{}`; own membership |
| `/api/transport/rides/:id/cancel` | POST | `{}`; driver and offer permission |

All endpoints require server-verified Access identity and `transport.view`. Writes reuse Origin/Sec-Fetch-Site protection, require JSON, reject unsupported fields/query parameters and limit streamed bodies to 4096 bytes. Resource IDs are validated; clients cannot submit an actor, driver identity, derived arrival, status, timestamp or event source. Responses use `Cache-Control: no-store`, expose only operational data and own-membership flags, and omit credentials, JWTs and emails. Transport stays within the existing portal onboarding gate.

## Local and preview migration

0004 is reserved for the parallel Duty Ops swaps branch; this branch does not supply or renumber it. 0005 does not depend on Duty Ops tables. Local isolated testing may apply the available migrations:

```powershell
npm run db:status:local
npm run db:migrate:local
```

**Do not remotely apply 0005 to the shared preview database until the Duty Ops 0004 and Transport 0005 branches have both been integrated in migration order.** After integration, review the migration list and confirm the target is the separate `studentportal-preview` database before applying:

```powershell
npx wrangler d1 migrations list DB --remote --env preview --config wrangler.jsonc
npx wrangler d1 migrations apply DB --remote --env preview --config wrangler.jsonc
npx wrangler d1 migrations list DB --remote --env preview --config wrangler.jsonc
```

Confirm 0001–0005, including 0004, are applied before activating Transport Functions in shared preview. Use two authenticated preview students to verify overlapping bookings and the final ride seat; grant offering only to the designated test driver. No remote migration, production deployment, master merge or resource/secret/binding change is part of this feature task. A branch preview against an unmigrated DB cannot serve Transport yet.

## UI and v1 limits

The Transport route provides compact two-car overview, reported recency, active/next trip, editable booking form, schedule, cancellation, trip confirmation and location reporting. Private rides have a separate list and optional offer form. The page reloads after mutations and refreshes visible data every minute; stale seat/conflict decisions are always resolved by the server. Styling is local to Transport and uses existing tokens and 44px controls.

The first version has no driver contact directory, notifications, live subscriptions, recurring trips, editing/rescheduling, fleet administration, GPS, maps, routing, automatic repositioning, payment, fuel, maintenance or Duty Ops/FlightLogger integration. Notes are plain text. Location correctness depends on users reporting honestly. Schedule/history reads are designed for the small initial two-car fleet and are not paginated; private rides disappear after departure, while unconfirmed ended car trips remain pending. Home's separate Transport label is left for the parallel UI/integration branch.
