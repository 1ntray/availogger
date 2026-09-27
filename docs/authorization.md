# Portal authorization

Cloudflare Access authenticates **who** signed in. Its verified JWT subject resolves an application user in D1. Portal authorization determines **what** that user may see and do, using D1 state on every protected API call. Email is metadata, never an identity or authorization key. Authentication, onboarding and encrypted FlightLogger credentials retain their existing behavior.

## Roles and permission catalogue

`shared/authorization.ts` defines typed permission keys and their UI descriptions. `0003_authorization.sql` deterministically seeds the same catalogue and the two system roles. Administrators can assign existing roles and overrides; they cannot create arbitrary roles or permissions.

| Permission | STUDENT default | Requires manage_permissions to edit |
| --- | --- | --- |
| `availability.view` | No | No |
| `duty_ops.view` | Yes | No |
| `duty_ops.swap` | No | No |
| `duty_ops.manage_schedule` | No | Yes |
| `transport.view` | Yes | No |
| `transport.offer_private_ride` | No | No |
| `transport.manage_university_cars` | No | Yes |
| `admin.manage_users` | No | Yes |
| `admin.manage_permissions` | No | Yes |

ADMIN is granted all nine current permissions by migration. Future permissions require explicit catalogue and migration changes, including an explicit ADMIN grant. They do not automatically become available to all users. STUDENT receives only Duty Ops view and Transport view. The migration backfills existing users lacking a role; a creation trigger assigns STUDENT to new application users. Removing a user's role does not cause it to be re-added on login.

`transport.offer_private_ride` authorizes publishing a private ride offer. It is not a claim about car ownership. Ride participation and university-car features can use independent permissions later.

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
5. Complete the existing FlightLogger onboarding if necessary, then open **Admin** or `/admin/users`. The admin UI follows the existing onboarding gate; the authenticated admin API itself does not require a stored FlightLogger key. Add another administrator as appropriate.
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
{"roles":["STUDENT"],"overrides":{"availability.view":"ALLOW","transport.view":"DENY"},"revision":7}
```

Removing a key from overrides restores role inheritance/default deny. Empty role lists are allowed (subject to final-admin safety). Unknown/duplicate roles, unknown permission keys/effects, extra fields, invalid revisions and oversized/malformed bodies are rejected. IDs select existing D1 records, never a submitted Access identity. PUT reuses the credential endpoint's Origin/Fetch Metadata protection; cross-site writes return 403. Changes cannot be submitted by GET. API errors are safe JSON, with no-store caching. No credentials, JWTs, internal role IDs or audit data are included.

`/admin/users` provides email search, role selection and per-permission Role default/Allow/Deny selectors. It shows current server access separately from the draft after saving, distinguishes inherited and explicit decisions, disables privileged controls when needed, prevents duplicate saves and restores the saved values after rejection. Successful saves use the returned server state and refresh `/api/me`; self-demotion immediately updates the current route/navigation.

## Feature integration

`/api/me` retains all previous identity/onboarding fields and adds typed `permissions` and public `roles`. `CurrentUserProvider` keeps these only in React memory. Desktop/mobile navigation and Home shortcuts are filtered. `RequirePermission` protects direct frontend URLs with a concise denial. Availability's API requires `availability.view` before credential decryption or cache access. Its queries/calendar/cache behavior is unchanged. Transport's placeholder is gated by `transport.view`. Settings and onboarding remain available through their existing account/onboarding gates.

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

The integrated read-only Duty Ops module now requires `duty_ops.view` through `withAuthorizedUser` before credential decryption or synchronization. Route/navigation/shortcut checks use the same permission. Tests cover role removal and explicit DENY before upstream access, and the client distinguishes portal 403 from an expired Access session. Future swaps must enforce `duty_ops.swap`; future scheduling/admin mutations must enforce `duty_ops.manage_schedule` with appropriate ownership checks. Those mutations and transport booking/ride systems remain unimplemented.

Before manual production activation, apply the reviewed migration, configure the bootstrap secret, verify owner/student sign-in, onboarding/replacement, authorized Availability, forbidden API access, direct routes and PWA behavior. Existing users become STUDENT and will lose Availability until explicitly granted access. No production migration or deployment is performed by this feature task.

## Verification on this branch

Backend TypeScript checks and all **119 backend tests** pass. After integrating the latest develop UI, all **60 frontend tests** (12 Node + 48 Vitest) pass, including admin edits/rejection/duplicate-submit behavior, existing onboarding/credential replacement and the account menu/responsive availability window. Frontend TypeScript, production Vite/PWA output, static-only service-worker/routing verification and Pages Functions compilation pass. Wrangler applied 0001 and 0003 to the isolated local D1 database and reported no pending migrations. Tests also validate backfill in a disposable database that initially has only 0001.

Browser checks of the built frontend with synthetic same-origin API fixtures verify the admin list/editor, inherited/explicit permission labels, successful save, phone layout without horizontal overflow, filtered Home/mobile More navigation, forbidden direct Availability URL, preserved onboarding redirect and authorized Availability controls. Backend tests exercise real local D1 and signed Access JWTs with mocked upstream calls. These checks do not establish live production readiness and use no real user credentials or production database.
