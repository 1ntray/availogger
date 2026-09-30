# Schedule and lifecycle notifications

Migration `0015_schedule_notifications.sql` adds immutable personal `schedule_change_events`, per-user raw FlightLogger observation snapshots, unread assignment groups, and Contact lifecycle projections. It is additive; existing `FLIGHT_CHANGE`, `EXCHANGE`, and historical `CONTACT_MESSAGE` Inbox items remain readable. No earlier migration is changed.

## Raw schedule observations

Duty Ops and Flyvask compare the authenticated user's own raw FlightLogger meetings with that user's preceding successful observation. These comparisons run in the same D1 batch as raw assignment synchronization. They never compare `duty_ops_effective_assignments` or `flyvask_effective_assignments`, which include portal Exchange overlays. An accepted portal exchange therefore generates an Exchange outcome, not a false FlightLogger assignment notification. Other participants and participant counts do not affect this comparison.

The first observation after migration or connection is a baseline. Replacing a FlightLogger key clears observation state and snapshots so the next successful sync is again a baseline. A later sync records `ASSIGNED`, `REMOVED`, or `TIME_CHANGED` with bounded old/new time snapshots. The immutable event table preserves these observations. Repeated syncs of the same raw state create no new event. Comparisons of additions/removals use the overlap of the previous and current sync windows; a newly exposed part of a wider window is baseline data rather than a flood of assignments.

The raw FlightLogger snapshot may lag changes made through another person's account. This is an observation stream, not a promise of real-time cross-account validation. FlightLogger stays read-only.

## Inbox grouping

Unread `ASSIGNED` events group per user and domain: Flights, Duty Ops, or Flyvask. `inbox_notification_groups` holds the count; `inbox_notification_group_events` links every underlying immutable flight or schedule event. Two additions before the group is read show one Inbox item with count two. The read endpoint closes the group in the same D1 batch that marks its Inbox item read. A later addition begins a new group. Detailed flight changes (time, cancellation, restoration, removal) and Duty Ops/Flyvask removal or time changes remain individual items. The source pages provide the operational details.

These rows are a relevance-filtered projection. They do not replace `flight_change_events`, `schedule_change_events`, or Exchange events. No client can create Inbox rows or choose recipients.

## Contact and feedback

Creating feedback notifies users who currently have `contact.webmaster.manage`, excluding the creator. A student's reply notifies those permission holders. Webmaster replies, explicit resolve, and explicit reopen notify the thread creator when another user performs the action. Unread replies of the same kind coalesce per recipient and thread; reading starts a new group for later replies. Contact messages remain immutable; explicit status transitions also have immutable `contact_thread_events`. An inaccessible thread renders as unavailable instead of exposing content. Older `CONTACT_MESSAGE` Inbox records remain valid.

## Exchange relevance

Exchange v2 keeps domain-owned notifications. Targeted requests, offers, and candidate decisions notify the person who needs to act. Completion notifies affected other participants, excluding the actor who just received a direct success response. Unseen actionable requests that another exchange has made irrelevant are removed; seen items can render a concise unavailable result. Exchange events are authoritative. Raw FlightLogger schedule events are never derived from Exchange effective assignments.

## Future delivery

The boundary is domain event → relevance and coalescing → personal Inbox item → future delivery channel. Web Push may later use this projection. This phase adds no push subscription, service-worker notification, permission prompt, email, or scheduled delivery job.
