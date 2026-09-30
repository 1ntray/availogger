# Brakkevakt

Brakkevakt is the student dormitory's weekly duty roster. The two assigned students keep shared spaces in order, including kitchens, trash and recycling. This version provides scheduling and direct swaps; it does not track individual chores. Studentportal's D1 assignments are the authoritative schedule. No FlightLogger booking, availability query or synchronization supplies it.

Current UI: new week exchanges use [Exchange v2](exchange-v2.md). My upcoming and This week lead, followed by a bounded Exchanges preview and the full Schedule; own weeks remain in both personal and full views. Students can select multiple acceptable target assignments or request another week directly when the server permits it. Open v1 swaps remain manageable in the same Exchange surface until resolved. Brakkevakt has no give-away or credit action.

## Weeks and assignments

Each period is keyed by its Europe/Oslo Monday date (`YYYY-MM-DD`) and runs from Monday 00:00 to the next Monday 00:00 local time. The UI labels the period Monday–Sunday. Calendar arithmetic handles 167-hour and 169-hour daylight-saving weeks. Event timestamps remain UTC ISO strings. A published week has exactly two distinct student assignments in stable slots; an unpublished partial week is only an intermediate step inside a transactional create operation.

Users with `brakkevakt.view` see the current and upcoming schedule at `/brakkevakt`. Their own current/upcoming weeks show the paired student and a swap action when permitted. `brakkevakt.swap` enables direct exchanges and personal accepted history at `/brakkevakt/swap-history`. STUDENT and ADMIN inherit both permissions. ADMIN also inherits privileged `brakkevakt.manage_schedule`. An administrator with permission-management rights can explicitly allow that capability for a designated student, or deny any of these permissions using the existing override editor.

`/brakkevakt/manage` lets a manager prepare several unsaved Monday rows, choose two existing STUDENT portal users for each, save rows, edit current/upcoming weeks and remove future weeks. The dedicated manager roster returns portal IDs and FlightLogger first/last names, without email or credentials. The manager UI does not require `admin.manage_users`. Schedule writes use expected revisions and a transactional permission/state guard. Immutable events record the actor, week, old/new assignee and time. Changing an assignment or removing a week atomically invalidates affected open swap requests/proposals and releases their reservations. A stale editor receives a conflict instead of overwriting another change.

## Original v1 direct swaps

An owner can request a swap of a current or upcoming assignment until the Oslo week ends. Another owner can offer an assignment from a different week; several offers may coexist. The requester accepts exactly one. One D1 batch rechecks permissions, status, ownership, both active weeks, reservations and both resulting two-person teams, then exchanges the canonical assignment owners, closes competing offers and releases locks. The unaffected partner in each week stays assigned. The received slot is immediately eligible for another exchange, so swap chains work. There is no give-away, take, credit transaction or debt.

History stores accepted week dates and counterparty identities separately from assignment foreign keys, so later manager edits or future-week removal do not erase accepted history. Only participants can see their own accepted exchanges. Ordinary schedule, swap, history and roster responses contain names and portal IDs, not email, Access subjects, FlightLogger IDs or credentials. Across the portal, stored FlightLogger first/last names are the primary display identity. Missing names become “Student” on student-facing pages; the Admin user list/editor use email as a fallback and retain email as secondary account information.

## Migration and release

`0010_brakkevakt.sql` adds only Brakkevakt tables, constraints, indexes and role grants. It has no dependency on the Flights/Fuel schema. It follows the merged `0009_flights_fuel.sql` migration. Follow the ordered [migration → application deployment workflow](database-updates.md); do not manually migrate preview or production. Migration tests cover both the original 0008 base and a populated post-0009 database.
