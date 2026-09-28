# Personal Inbox backend

`user_inbox_items` stores a personal pointer to an immutable source event and a nullable `read_at`. It currently has one producer: `FLIGHT_CHANGE` from successful flight synchronization. Future source domains can add their own kind/source type after deriving recipients under that domain's authorization rules. There is no endpoint for a client to send an item to an arbitrary user.

Inbox, Needs Attention, and Activity are distinct. Reading an item changes only `read_at`; it never resolves a fuel request, swap, or other operational record. Source records own their state and history. No push, email, subscription, or notification permission is implemented here.

`GET /api/inbox` returns the current authenticated user's latest 30 items by default (maximum 50 via `?limit=`), an unread count, and a cursor for the next page. Order is `created_at DESC, id DESC`; the cursor carries those two fields. Each current `FLIGHT_CHANGE` item includes a title, compact summary, `/flights` target, last-known flight snapshot, and bounded old/new field snapshots. `POST /api/inbox/:itemId/read` has an empty body, requires same-origin request checks, sets server time once, and is idempotent. Another user's ID returns the same 404 as a missing ID. Both endpoints use the existing Cloudflare Access application-user identity and `Cache-Control: no-store`; no new role permission is needed for one's own Inbox.

The backend deliberately adds no bell, navigation entry, badge, or Inbox page. A separate UI branch can consume these typed endpoints later. Source events and Inbox items have no retention job yet; pagination bounds response size, and a later retention policy can be designed separately.
