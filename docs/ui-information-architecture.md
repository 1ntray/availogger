# Studentportal information architecture

## Before refactor: product audit and main jobs

The desktop sidebar currently lists Home, Duty Ops, Flights, Transport, Flyvask, Brakkevakt, Availability, Settings and Admin. On phones, its first three entries become tabs and everything else is hidden under More. Duty Ops, Flyvask and Brakkevakt each add history tabs; Duty Ops also gives credits equal prominence to the schedule. Home repeats the navigation as large cards. A shift's tasks and exchange action are separate peers. Brakkevakt repeats assignments and its manager chooses a calendar date for a weekly roster. Access management is one flat permission list. Healthy sync diagnostics take space on operational pages.

The main jobs are: see the next personal commitment and surrounding cover; inspect flights and request fuel; inspect or exchange Duty Ops and Flyvask assignments; see and swap Brakkevakt weeks; review personal accepted activity; manage access and specialist tools when authorized. Existing routes and APIs already support most of these jobs, but their presentation follows feature history instead of frequency of use.

## Target structure

| Level | Destinations | Purpose |
| --- | --- | --- |
| Primary desktop/sidebar and mobile bar | Home, Flights, Duty Ops, Flyvask, Brakkevakt | Repeated student work, filtered by permission. All five fit in the normal phone bar. |
| Profile menu | My activity, Settings, Administration when permitted | Personal and global actions. Name on the closed button; email inside. No sign out action exists in the current Access integration. |
| Administration hub | Users & access, Instructor availability, Duty Ops credit audit | Explicit permission on each entry and route. Brakkevakt schedule management stays in Brakkevakt. |
| Contextual routes | Shift workspace, Brakkevakt manage schedule | Actions attached to an object or module. |

Old personal history links redirect to My activity with the corresponding filter. Availability moves to `/admin/availability`; an authorized old link redirects there. Transport is retired from active UI, API and typed permission catalogue. Its released D1 migration and historical tables remain untouched.

## Shared interaction rules

- Page title, current data and primary action come before diagnostics. Healthy status is one quiet `Updated…` line; reveal detailed sync metadata only on demand. Stale or failed data remains explicit.
- Use a small set of page widths and the existing tokens, outline icons, quiet borders, 44px touch targets, visible focus and textual statuses. Rows support scanning; cards group real related content.
- Show empty content briefly and avoid stacking empty exchange groups. Dialogs keep their decision area and footer stable while choices change; native dialog keyboard, focus and Escape behavior remain intact.
- Permission checks guard links **and** data requests. Personal activity uses existing personal history endpoints only. Full credit standings require server-side `duty_ops.manage_schedule`.
- Effective/current state is the primary truth. A small, consistent amber attention disclosure marks a discrepancy or secondary condition; expanding it explains the source detail. The marker communicates a real condition, never decoration. Duty Ops and Flyvask show effective Studentportal assignments first and reveal raw FlightLogger assignments only when they differ.
- Mobile exposes the useful permitted primary destinations directly, with the profile menu for global actions. Long labels remain legible at 320–430px; no arbitrary first-three rule.

## Page composition

- **Home:** time-ordered My schedule from own flights, effective Duty Ops, nearby Flyvask and own Brakkevakt; Around me shows relevant cover near a flight and the current Brakkevakt roster when the user is not already assigned. Needs attention appears only for fuel review or stale source data. It uses bounded existing endpoints. No module-card duplicate navigation.
- **Flights:** retain the scannable own-flight list and fuel action; emphasize time, aircraft, route, instructor and fuel state.
- **Duty Ops:** Today, My upcoming shifts, Schedule. The shift row opens one workspace for tasks and exchange. Credit balance appears when making a give-away decision. Healthy sync is compressed; raw versus effective assignment remains available when operationally useful.
- **Flyvask:** own assignments are visible in the schedule; direct exchange remains contextual. Accepted history moves to My activity.
- **Brakkevakt:** week-first This week and Upcoming list with own assignment inline once. Management selects a start week and count, retaining multi-week generation and saving. Direct swaps remain functional.
- **My activity:** accepted personal Duty Ops, Flyvask and Brakkevakt swaps combined chronologically with simple module filters and pagination. Each source can fail independently.
- **Admin:** hub links follow effective permissions. Users and access groups the catalogue by domain, places the resulting Allowed/Denied state first, and marks unsaved changes. Audit stays privileged.
- **Settings and Availability:** keep operational instructions and calendar legend/timezone where needed. Availability is an administrative tool, never part of the normal student navigation.
