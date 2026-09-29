# Flights and fuel requests

## Source and access

`GET /api/flights` uses the authenticated student's encrypted FlightLogger credential. It queries only `SingleStudentBooking` and `MultiStudentBooking` with `all: false`, bounded 50-node cursor pagination, and a default seven-day-past / 60-day-future Europe/Oslo window. Each booking is accepted for that user only when the independently checked FlightLogger self ID appears as a student. There is no global flight browse API and no cross-account credential use. A per-user token hash, time window and five-minute synchronization state limit repeated reads. Failed refreshes may show a clearly marked, previously synchronized window; first loads fail closed. FlightLogger is read-only.

`flights` holds the shared canonical booking, `flight_students` holds only proved portal memberships, and `flight_sync_state` holds per-user freshness. Other participant names are not stored from a student's booking response. FlightLogger booking and aircraft IDs are stable identity keys. Callsigns are only fuel-profile matchers and display labels. A same-aircraft earlier-flight advisory is the latest known linked, non-cancelled booking ending before the target flight. Flight end is preferred; booking end is labelled as a fallback. It is a partial timeline assembled from independently linked users, never a complete aircraft plan or a completion gate.

`startsAt` is the booking/briefing start and the primary student arrival time. When later, `flightStartsAt` ends the brief and starts the flight; `flightEndsAt` ends the flight; a later `endsAt` ends the debrief. Missing flight boundaries are shown as missing, never inferred. All displayed times use Europe/Oslo and 24-hour clocks. Home sorts flights by booking start. Flights and Home show registration, instructor (on Flights), and planned lessons without aircraft model or airport route clutter.

The FlightLogger query requests `SingleStudentBooking.plannedLesson` or `MultiStudentBooking.plannedLessons`, selecting only `Training.id/name` and `Lecture.id/name`. The parser accepts at most eight lessons with bounded IDs/names, and migration `0014_flight_schedule_details.sql` stores them in `flight_planned_lessons` by source order. Existing rows have no lessons until refreshed. Display uses source names; when Training and Lecture names differ it shows both. Lesson edits update the current schedule but do **not** currently create flight-change Inbox notifications; the existing flight-change item constraint remains unchanged.

## Profiles and requests

Migration `0009_flights_fuel.sql` adds `flights.view` and `fuel.request` to STUDENT and ADMIN. Explicit DENY/ALLOW overrides still apply. It seeds C182T and Z242L presets and a DA42 profile with **no** invented presets. Presets retain their existing meaning. C182T custom quantities are always **US gallons**. Z242L custom quantities are always the **desired total fuel on board in litres**, with a minimum of 116 L; full mains (116 L) are assumed, `aux total = desired total − 116`, and `each aux = aux total / 2`. The form shows this split before submission, and Duty Ops receives the structured breakdown. DA42 retains its existing generic L/US_GAL custom choice. The backend enforces profile-specific units and minimums even for manipulated requests. Unmatched aircraft and simulators have no fuel order option. Fuel orders require an OPEN booking, assigned aircraft, usable flight start, Bardufoss departure ID `2953`, and an operationally relevant booking window. Planned departure time alone is never an expiry.

`fuel_requests` has one current non-cancelled request per flight, including multi-student bookings. Any linked student with `fuel.request` can create, edit a PENDING request, cancel a PENDING request, or resolve NEEDS_REVIEW with a new choice. A completed request cannot be edited normally. Request snapshots retain the original aircraft, departure, time and fuel choice; `fuel_request_events` records state changes without credentials or arbitrary payloads. D1 unique constraints and transactional `changes()` guards reject simultaneous duplicate creation, stale edits and duplicate completion. Source aircraft/departure changes move PENDING or COMPLETED orders to NEEDS_REVIEW; previous completion history remains. A cancelled FlightLogger flight closes a pending order. Time changes use current canonical flight time for routing.

## Duty Ops tasks

`/duty-ops/shifts/:shiftId` is a bookmarkable workspace for the current effective Duty Ops team. Its API checks `duty_ops_effective_assignments`, so accepted portal give-aways and swaps immediately change visibility and completion rights without changing raw FlightLogger assignments. It shows PENDING tasks when the flight start or T-60 attention time overlaps the shift. Once a shift has started, overdue pending tasks from before its start carry over. T-60 controls priority, not initial visibility or permission to complete. There is no fixed `active_until`, stored assignee, claim step, or start step. A relevant team member with `duty_ops.view` can click **Complete** once; a database transaction records one authoritative actor/time and one completion event.

## Same-origin API

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /api/flights` | `flights.view` | Own synchronized flights and request state |
| `POST /api/flights/:flightId/fuel` | `fuel.request` + linked student | Create; `{kind:"PRESET",presetKey}` or `{kind:"QUANTITY",quantityValue,quantityUnit}` |
| `PUT /api/flights/:flightId/fuel` | Same | Edit pending / resolve review |
| `DELETE /api/flights/:flightId/fuel` | Same | Cancel pending |
| `GET /api/duty-ops/shifts/:shiftId/tasks` | `duty_ops.view` + effective member | Shift's planned/due work |
| `POST /api/duty-ops/shifts/:shiftId/tasks/:requestId/complete` | Same | Complete one relevant pending task |

Mutations enforce same-origin requests, bounded strict JSON where applicable, parameterized SQL, transactional permission/membership checks, and `Cache-Control: no-store`. No API exposes encrypted credentials or a generic FlightLogger proxy.

## Local migration and release

From the repository root, run `npm run db:migrate:local` against the local D1. `npm test`, `npm run check`, `npm --prefix frontend test`, `npm --prefix frontend run build`, and `npm run functions:build` verify the implementation without live FlightLogger. The ordered GitHub release workflow applies pending migrations to preview D1 **after** validation and **before** the develop Pages deploy; production follows the master flow later. Do not apply migration 0014 to remote databases during feature development or PR CI. It is additive and works with the previous deployed code.

The current FlightLogger snapshot can lag other students' changes, and the known aircraft timeline is intentionally partial. No FlightLogger mutations, inferred fuel quantities, global aircraft scheduling, notifications, or automatic fuel completion are part of this phase.
