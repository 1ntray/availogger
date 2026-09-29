# Studentportal information architecture

## Before refactor: product audit and main jobs

The desktop sidebar currently lists Home, Duty Ops, Flights, Transport, Flyvask, Brakkevakt, Availability, Settings and Admin. On phones, its first three entries become tabs and everything else is hidden under More. Duty Ops, Flyvask and Brakkevakt each add history tabs; Duty Ops also gives credits equal prominence to the schedule. Home repeats the navigation as large cards. A shift's tasks and exchange action are separate peers. Brakkevakt repeats assignments and its manager chooses a calendar date for a weekly roster. Access management is one flat permission list. Healthy sync diagnostics take space on operational pages.

The main jobs are: see the next personal commitment and surrounding cover; inspect flights and request fuel; inspect or exchange Duty Ops and Flyvask assignments; see and swap Brakkevakt weeks; review personal accepted activity; manage access and specialist tools when authorized. Existing routes and APIs already support most of these jobs, but their presentation follows feature history instead of frequency of use.

## Target structure

| Level | Destinations | Purpose |
| --- | --- | --- |
| Primary desktop/sidebar and mobile bar | Home, Flights, Duty Ops, Flyvask, Brakkevakt | Repeated student work, filtered by permission. All five fit in the normal phone bar. |
| Profile menu | My activity, Inbox, My messages, Send feedback, Settings, Administration when permitted | Personal and global actions. Name on the closed button; email inside. The header bell opens Inbox. No sign out action exists in the current Access integration. |
| Administration hub | Users & access, Instructor availability, Duty Ops credit audit, Contact messages | Explicit permission on each entry and route. Brakkevakt schedule management stays in Brakkevakt. |
| Contextual routes | Shift workspace, Brakkevakt manage schedule | Actions attached to an object or module. |

Old personal history links redirect to My activity with the corresponding filter. Availability moves to `/admin/availability`; an authorized old link redirects there. Transport is retired from active UI, API and typed permission catalogue. Its released D1 migration and historical tables remain untouched.

## Shared interaction rules

- Page title, current data and primary action come before diagnostics. The shared `PageHeader` and `RefreshControl` keep healthy refresh quiet (`Updated…` plus an accessible 44px icon button). Errors and stale data make Retry explicit. Detailed source sync information is disclosed on demand.
- Use the shared primary, secondary, ghost and danger button roles by intent. Navigation uses links; selectable exchange choices retain native radio semantics with a visible selected state. The same compact bottom sheet and action footer serve exchange confirmations on phones.
- Use a small set of page widths and the existing tokens, outline icons, quiet borders, 44px touch targets, visible focus and textual statuses. Rows support scanning; cards group real related content.
- Show empty content briefly and avoid stacking empty exchange groups. Dialogs keep their decision area and footer stable while choices change; native dialog keyboard, focus and Escape behavior remain intact.
- Permission checks guard links **and** data requests. Personal activity uses existing personal history endpoints only. Full credit standings require server-side `duty_ops.manage_schedule`.
- Effective/current state is the primary truth. A small, consistent amber attention disclosure marks a discrepancy or secondary condition; expanding it explains the source detail. The marker communicates a real condition, never decoration. Duty Ops and Flyvask show effective Studentportal assignments first and reveal raw FlightLogger assignments only when they differ.
- Mobile exposes the useful permitted primary destinations directly, with the profile menu for global actions. Treat 360–430 CSS px as the main layout and review 360, 390, 412 and 430 before expanding to tablet and desktop. Keep bottom navigation and safe-area padding.

### Mobile-first reference

Start at 390 CSS px, then check 360, 412 and 430. The header, five-item bottom bar, primary action and first operational rows must fit without horizontal scrolling. Tablet and desktop can widen lists and restore the sidebar; they must retain the phone's action order. Keep row metadata on one or two scannable lines and omit empty groups.

### Shared action and refresh priority

Use primary for a commit, secondary for a meaningful alternative, ghost for refresh/back/cancel, and danger for removing published work. `ActionButton`, `BackLink`, `PageHeader` and `RefreshControl` in `frontend/src/app/controls.tsx` provide those patterns. A healthy refresh is a quiet labeled icon with a 44px target; stale or failed data displays Retry. Sync diagnostics stay behind disclosure. Operational errors and meaningful amber attention markers remain readable in text.

### Duty Ops state and exchange

Lead with future personal shifts, show only currently active assignments in On duty now, place active exchanges before the longer schedule, and avoid repeating own shifts in that schedule. Completed or cancelled work stays out of current sections. An own shift offers Exchange and an explicit workspace link. Other students' shifts show effective coverage but never link to their protected workspace. Disclose differing FlightLogger source assignments with the shared attention marker. Use the same compact mobile exchange sheet and selected choice pattern across Duty Ops, Flyvask and Brakkevakt.

### Home time grouping

Group timed commitments as Today, Tomorrow, named near-term days and Upcoming. Limit only the distant Upcoming group. Keep Brakkevakt as weekly context and attach relevant Duty Ops coverage to a flight as text. Render data as each permitted source arrives without a global loading message over existing items.

## Page composition

- **Home:** Today, Tomorrow, named near-term days and Upcoming group timed personal work before limiting distant entries. Current Brakkevakt appears as weekly context. Duty Ops cover sits beside its flight as readable context, without a link to another student's protected shift workspace. Needs attention appears only for fuel review or stale source data. Existing endpoints remain permission gated.
- **Flights:** retain the scannable own-flight list and fuel action; emphasize time, aircraft, route, instructor and fuel state.
- **Duty Ops:** My upcoming shifts lead, followed by shifts active now, active exchanges and the longer schedule. Own rows offer Exchange directly and link to the shift workspace; other students' rows do not link to protected detail routes. Completed earlier shifts do not remain in the active section. Credit balance appears at give-away decisions. Effective assignment remains primary, with a discrepancy disclosure for FlightLogger source data.
- **Flyvask:** compact schedule rows show time, participants and location together; own assignments retain direct swap access. Empty exchange groups are omitted. Accepted history stays in My activity.
- **Brakkevakt:** concise week labels such as `Week 40 · 28 Sep–4 Oct` keep full dates in supporting metadata. This week and Upcoming keep own assignment inline. Management generates multiple draft weeks and uses one Save changes action for completed, changed rows, retaining revisions and remove confirmation. Direct swaps remain functional.
- **My activity:** accepted personal Duty Ops, Flyvask and Brakkevakt swaps combined chronologically with simple module filters and pagination. Each source can fail independently.
- **Admin:** hub links follow effective permissions. Users and access groups the catalogue by domain, places the resulting Allowed/Denied state first, and marks unsaved changes. Audit stays privileged.
- **Settings and Availability:** keep operational instructions and calendar legend/timezone where needed. Availability is an administrative tool, never part of the normal student navigation.
