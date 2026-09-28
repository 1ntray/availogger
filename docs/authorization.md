# Portal authorization

Cloudflare Access authenticates **who** signed in. Its verified JWT subject resolves an application user in D1. Portal authorization determines **what** that user may see and do, using D1 state on every protected API call. Email is metadata, never an identity or authorization key. Authentication, onboarding and encrypted FlightLogger credentials retain their existing behavior.

## Roles and permission catalogue

`shared/authorization.ts` defines the active typed permission keys and UI descriptions. Released migrations seed the database catalogue and the two system roles. Administrators can assign active roles and overrides; they cannot create arbitrary roles or permissions. Historical Transport rows remain in D1 but are filtered from active API responses and the editor.

| Permission | STUDENT default | Requires manage_permissions to edit |
| --- | --- | --- |
| `availability.view` | No | No |
| `duty_ops.view` | Yes | No |
| `duty_ops.swap` | No | No |
| `duty_ops.manage_schedule` | No | Yes |
| `flights.view`, `fuel.request` | Yes | No |
| `flyvask.view`, `flyvask.swap` | Yes | No |
| `brakkevakt.view`, `brakkevakt.swap` | Yes | No |
| `brakkevakt.manage_schedule` | No | Yes |
| `admin.manage_users` | No | Yes |
| `admin.manage_permissions` | No | Yes |

Future permissions require explicit catalogue and migration changes, including an explicit ADMIN grant. They do not automatically become available to all users. The migrations backfill existing users lacking a role; a creation trigger assigns STUDENT to new application users. Removing a user's role does not cause it to be re-added on login. Instructor Availability is available only to ADMIN or users explicitly granted `availability.view`.

Permission resolution order is explicit DENY, explicit ALLOW, any role grant, then default DENY. The D1 `effective_user_permissions` view is the single resolver, used by backend helpers and transactional safety checks. Unknown application permission keys fail closed.

## Database and transaction safety

Migration `0003_authorization.sql` adds `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permission_overrides`, `authorization_audit_log` and the singleton `authorization_state` revision, plus the resolver view and new-user trigger. Primary/unique keys, foreign keys, override-effect and system-role checks enforce the schema.

Access edits use a transactional D1 batch. The first statement checks the editor revision and the actor's current effective permissions before advancing the revision. A final statement rejects the entire batch if it would leave no ADMIN assignment or no user with both effective administrative permissions. An assigned ADMIN whose administrative permission is explicitly denied does not count as an effective administrator. Failed or stale edits roll back all roles, overrides, revision and audit records. A conflict returns safe HTTP 409; reload before editing again. The global revision also prevents simultaneous demotions and concurrent privilege revocation from bypassing these checks. D1 batches provide transaction rollback on statement failure ([Cloudflare D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)).

Each role addition/removal and override addition/change/removal records actor/target application IDs, action, key, previous/new value and timestamp. Bootstrap is also audited. Credential material, JWTs, bootstrap configuration and email metadata are never stored in this audit. No audit-reading or account-deletion API is added.

System-role definitions and grants are not mutable through this API. Direct database operations are outside the admin API safety boundary; future permission/role editors must use equivalent transaction checks and advance the revision.

## Initial administrator setup

No real subject is included in source. `PORTAL_BOOTSTRAP_ADMIN_SUBJECT` is a server-side Pages runtime **secret**, not a Vite variable.

1. Provision the existing DB/encryption/Access configuration and review/apply the authorization migration to the intended environment before activating this code. This feature task applies migrations locally only; production setup is a separate manual action.
2. Sign into that portal through Cloudflare Access as the intended owner. In the same authenticated browser, open `/api/me`. Copy the exact `subject` field from that verified response. It is the Access JWT `sub`; do not use email, decode an unverified token, or paste a subject into Git/chat/logs. The existing `/api/me` subject field is retained for compatibility; no bootstrap configuration field is exposed.
3. In Cloudflare **Workers & Pages → availogger → Settings → Variables and Secrets**, select the intended environment, add `PORTAL_BOOTSTRAP_ADMIN_SUBJECT`, choose **Secret/Encrypt**, and save that exact subject. Keep Production and Preview secrets/database bindings separate. Activate the setting through the environment's normal deployment process. Pages runtime secrets are documented in [Cloudflare bindings](https://developers.cloudflare.com/pages/functions/bindings/#secrets).
4. Reload the portal. When there is no ADMIN assignment and the server-verified current subject matches exactly, the backend atomically assigns ADMIN to that application user and records the audit. `/api/me` will include ADMIN and the effective permissions. A missing/mismatched secret does nothing. Any existing ADMIN assignment disables bootstrap, even if its permissions have overrides.
5. Complete the existing FlightLogger onboarding if necessary, then open **Administration** or `/admin/users`. The admin UI follows the existing onboarding gate; the authenticated admin API itself does not require a stored FlightLogger key. Add another administrator as appropriate.
6. Once access is confirmed, remove the bootstrap secret if one-time setup is preferred, or retain it securely for recovery when no ADMIN assignments exist. Normal API edits cannot remove the final ADMIN assignment/effective administrator. Recovery after manual database corruption or denied admin overrides requires deliberate database repair; bootstrap does not override an existing ADMIN assignment.

Local testing can add `PORTAL_BOOTSTRAP_ADMIN_SUBJECT=local-development` to ignored `.dev.vars` alongside the existing local settings. That synthetic subject is available only with the explicit loopback development bypass. Never enable `LOCAL_ACCESS_DEV` on a public host.

## Admin API and UI

All endpoints require verified Access, a server-resolved D1 application user and effective `admin.manage_users`. Administrative/management overrides and ADMIN role changes additionally require `admin.manage_permissions`. Having only manage_users cannot grant/revoke either administrative permission or promote anyone to ADMIN, including oneself.

| Endpoint | Response / behavior |
| --- | --- |
| `GET /api/admin/users` | D1 user list: application ID, email, role keys, effective permissions |
| `GET /api/admin/permissions` | Application catalogue with descriptions/privilege classification and system roles with current grants |
| `GET /api/admin/users/:id/access` | User metadata, roles, effective/inherited permissions, overrides, revision |
| `PUT /api/admin/users/:id/access` | Replace the selected user's role assignments/overrides; returns saved access state |

PUT body example:

```json
{"roles":["STUDENT"],"overrides":{"availability.view":"ALLOW"},"revision":7}
```

Removing a key from overrides restores role inheritance/default deny. Empty role lists are allowed (subject to final-admin safety). Unknown/duplicate roles, unknown permission keys/effects, extra fields, invalid revisions and oversized/malformed bodies are rejected. IDs select existing D1 records, never a submitted Access identity. PUT reuses the credential endpoint's Origin/Fetch Metadata protection; cross-site writes return 403. Changes cannot be submitted by GET. API errors are safe JSON, with no-store caching. No credentials, JWTs, internal role IDs or audit data are included.

`/admin/users` provides name/email search, role selection and per-permission Role default/Allow/Deny selectors grouped by module. The resulting Allowed/Denied state is prominent, with unsaved changes marked. Privileged controls remain disabled when needed; duplicate saves are blocked and rejected changes restore saved values. Successful saves use the returned server state and refresh `/api/me`; self-demotion immediately updates the current route/navigation.

## Feature integration

`/api/me` retains all previous identity/onboarding fields and adds active typed `permissions` and public `roles`. `CurrentUserProvider` keeps these only in React memory. Desktop/mobile navigation and Home data requests are filtered. `RequirePermission` protects direct frontend URLs with a concise denial. Availability's API requires `availability.view` before credential decryption or cache access; the UI places it under `/admin/availability`. Its queries/calendar/cache behavior is unchanged. Settings and onboarding remain available through their existing account/onboarding gates. Full Duty Ops credit standings require `duty_ops.manage_schedule` on the server.

Add a real future permission to the shared catalogue and a new migration; do not invent an undeclared key at runtime. Backend pattern (using a future, explicitly declared `example.view`):

```ts
return withAuthorizedUser(context, 'example.view', async (db, user) => {
  // Protected feature work. Or await requirePermission(db, user, 'example.view').
  return json(await loadFeature(db, user));
});
```

Frontend pattern, after declaring that key:

```tsx
const { hasPermission } = usePermissions();
return hasPermission('example.view') ? <FeatureLink /> : null;
// Router: <Route element={<RequirePermission permission="example.view" />}>…</Route>
```

Frontend checks provide UX; APIs remain the authority and must never trust browser claims. Sensitive mutations should also recheck actor permissions inside their transaction.

## Parallel Duty Ops integration and rollout

`0002` is reserved for the parallel Duty Ops migration; `0003` has no dependency on it. Do not renumber existing migrations. Once both PRs are in develop, review migration status/order before applying to any environment, including databases that already applied 0003 during isolated testing.

Duty Ops requires `duty_ops.view` through `withAuthorizedUser` before credential decryption or synchronization. Route/navigation/Home checks use the same permission. Swaps enforce `duty_ops.swap`; full credit standings enforce `duty_ops.manage_schedule`. Tests cover role removal and explicit DENY before upstream access, and the client distinguishes portal 403 from an expired Access session.

Before manual production activation, apply the reviewed migration, configure the bootstrap secret, verify owner/student sign-in, onboarding/replacement, authorized Availability, forbidden API access, direct routes and PWA behavior. Existing users become STUDENT and will lose Availability until explicitly granted access. No production migration or deployment is performed by this feature task.

## Verification

Run the current TypeScript, frontend, backend, Pages Functions and migration checks described in the repository scripts before deployment. Backend tests exercise local D1 with mocked upstream calls. Browser checks should cover the five-destination mobile bar, account menu, permission-aware Administration hub, denied routes and the Availability calendar. No real user credentials or production database are needed for local verification.
