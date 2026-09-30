# Home redesign brief (mobile first)

Implementation script for the approved Home mock-up. Follow it top to bottom. Mobile is the priority: the portal is used as an installed PWA on phones. Desktop must keep working and pick up the new font and cards, but the desktop chrome (navy header + sidebar) is **out of scope** for this PR.

Reference mock-ups (static HTML, open in a browser; the phone ones at 390px wide):

- `docs/mockups/home-phone-light.html`, `docs/mockups/home-phone-dark.html` — the target.
- `docs/mockups/home-desktop-light.html`, `docs/mockups/home-desktop-dark.html` — desktop direction; only the **content area** applies to this PR.

The mock-ups use real data from one account (Wed 30 Sep 2026). Everything in them maps to an existing API; nothing new is needed from the backend.

## Ground rules

- Branch `feature/home-mobile-redesign` (this file lives on it), PR into `develop`. Never push to `master`.
- Frontend only: `frontend/`. Do not touch `backend/`, `functions/`, `migrations/`, `wrangler.jsonc`, `wrangler.local.jsonc`, workflows or Access configuration.
- No new runtime dependencies. Icons are inline SVG in `Icon.tsx`. The font is self-hosted.
- Keep every existing test green and add tests for the new logic. Before pushing: `npm run check`, `npm --prefix frontend test`, `npm test`, `npm run build`.
- Keep dark mode working through the tokens in `frontend/src/tokens.css`. No hard-coded colours in component CSS; every colour is a `var(--portal-…)`.
- Keep the accessibility that is already there: 44px touch targets on phones, visible focus rings, `aria-*` on icon-only controls, text contrast ≥ 4.5:1 in both themes.
- Never commit secrets: `.dev.vars` is git-ignored; the FlightLogger key is pasted into the running app, not into files.

## Local run (for screenshots)

`npm run dev` is broken with the pinned Wrangler (`--config` is not accepted by `pages dev`). Use this instead:

```sh
npm ci && npm --prefix frontend ci && npm run build
mkdir -p /tmp/devrun/frontend && cd /tmp/devrun
cp ~/availogger/wrangler.local.jsonc wrangler.jsonc          # never the root wrangler.jsonc (production IDs)
ln -s ~/availogger/frontend/dist frontend/dist
for d in functions backend shared node_modules migrations; do ln -s ~/availogger/$d $d; done
printf 'LOCAL_ACCESS_DEV=true\nFLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY=%s\nPORTAL_BOOTSTRAP_ADMIN_SUBJECT=local-development\n' \
  "$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")" > .dev.vars
npx wrangler d1 migrations apply DB --local
npx wrangler pages dev --port 8789
```

The app then runs at `http://127.0.0.1:8789` signed in as `local@localhost`. The first visit asks for a FlightLogger API key: ask the user for one, paste it in the onboarding form. Rebuild (`npm run build` in the repo) and reload after frontend changes. Screenshot with Playwright (`chromium` is pre-installed at `/opt/pw-browsers/chromium`): viewport 390×844 with `colorScheme: 'light'` and `'dark'`, plus 1366×900.

## Step 1 — Foundations

### 1a. Font: Manrope, self-hosted

1. Get the variable font `Manrope[wght].ttf` from the Manrope release (OFL licence) or the Google Fonts CSS (`https://fonts.googleapis.com/css2?family=Manrope:wght@500..800`) and convert/download the latin + latin-ext `woff2` files. Put them in `frontend/public/fonts/` with `OFL.txt` beside them. Target ≤ 60 KB per file.
2. In `frontend/src/tokens.css`, before `:root`:
   ```css
   @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 500 800; font-display: swap; src: url('/fonts/manrope-latin.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
   ```
   (Norwegian æ ø å are in that range. Add a latin-ext face only if the file is small.)
3. `frontend/src/styles.css`: change the `font-family` on `:root` to `'Manrope', ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` and add `-webkit-font-smoothing: antialiased`.
4. `frontend/pwa.config.ts`: add `'fonts/*.woff2'` to `injectManifest.globPatterns` so the font is precached.
5. `frontend/index.html`: add `<link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>`.
6. If downloading the font is impossible in your environment, fall back to a Google Fonts `<link>` in `index.html` with `preconnect`, and say so in the PR. Self-hosting is preferred.

### 1b. Tokens (`frontend/src/tokens.css`, both themes)

Add to `:root` (light) and `:root[data-theme="dark"]` (dark):

| token | light | dark |
| --- | --- | --- |
| `--portal-radius-md` | `8px` | same |
| `--portal-radius-lg` | `12px` | same |
| `--portal-shadow-card` | `0 1px 2px rgba(23, 40, 51, .06)` | `0 1px 2px rgba(0, 0, 0, .4)` |
| `--portal-warning-background` | `#fbf1e0` | `#2b2415` |
| `--portal-space-5` | `20px` | same |
| `--portal-space-6` | `24px` | same |
| `--portal-space-8` | `32px` | same |

Existing tokens the design uses: `--portal-surface` (cards), `--portal-surface-muted` (inset panels, skeletons), `--portal-border`, `--portal-text`, `--portal-secondary`, `--portal-muted`, `--portal-accent` (links, icons), `--portal-accent-fill` / `--portal-on-accent` (primary button), `--portal-nav-active` / `--portal-nav-active-text` (soft green chip, active nav, today cell, avatar), `--portal-warning-text` (amber chip text), `--portal-brand-mark` / `--portal-brand-mark-text`.

### 1c. Type scale

- Page title: 22px / 800 / letter-spacing -0.02em on phones, 28px on desktop (existing `h1` rule, keep it).
- Card title (`h2` inside a card): 15px / 800 / -0.01em.
- Row title: 15px / 700. Body: 14px. Meta: 13px muted. Caption/eyebrow: 12px; eyebrow is 800, uppercase, letter-spacing .06em, muted.
- Every time, date number and count: `font-variant-numeric: tabular-nums`.

### 1d. One button system

`portal.css` has three button families (`.refresh-button`/`.today-button`, `.primary-button`, `.ui-button`). Make `.ui-button` the system:

- Base: inline-flex, gap 8px, height 40px (44px at ≤ 600px), padding 0 14px, radius `--portal-radius-md`, font 14px / 700, border 1px `--portal-border`, background `--portal-surface`, colour `--portal-text`.
- `--primary`: background and border `--portal-accent-fill`, colour `--portal-on-accent`; hover `--portal-accent-fill-hover`.
- `--ghost`: transparent border and background, colour `--portal-muted`.
- `--danger`: unchanged.
- Keep `.primary-button`, `.refresh-button`, `.today-button` as aliases (`.primary-button { …same declarations… }`) so other pages don't change in this PR. Remove the aliases in a later cleanup.

### 1e. Icons

Extend `frontend/src/app/Icon.tsx`:

- Add a `size` prop (default 22, the current size) and set `strokeWidth` to 2 for the new icons (keep 1.6 for the existing nav icons unless you replace them).
- Add these names with the paths from `docs/mockups/home-phone-light.html` (they are Lucide icons, MIT): `plane`, `clipboard`, `droplet`, `refresh`, `chevron-right`, `check-circle`, `inbox`, `users`, `clock`, `shield`, `swap`. Replace the nav icons `flights`, `duty`, `wash`, `calendar`, `home` with the Lucide versions from the mock-up so the set is consistent. Update `NavIcon`/`IconName` types.

## Step 2 — Shared UI pieces

Create `frontend/src/app/ui.tsx` and `frontend/src/app/ui.css` (import the CSS from `main.tsx` after `portal.css`):

- `Card({ title, aside, children, className })` → `<section class="card">` with an optional header row `<div class="card-head"><h2>title</h2>{aside}</div>`. Card: background `--portal-surface`, border 1px `--portal-border`, radius `--portal-radius-lg`, shadow `--portal-shadow-card`, padding 16px (20px on desktop), `display:flex; flex-direction:column; gap:14px`.
- `Chip({ tone: 'soft' | 'warning' | 'neutral', children })` → `<span class="chip chip--tone">`; height 22px, padding 0 8px, radius 999px, 12px / 700. Soft: `--portal-nav-active` / `--portal-nav-active-text`. Warning: `--portal-warning-background` / `--portal-warning-text`. Neutral: `--portal-surface-muted` / `--portal-secondary`.
- `EmptyState({ icon, title, body })` → 40px icon tile (`--portal-surface-muted`, radius 10px, icon 20px muted), title 14px / 700, body 12px muted.
- `Avatar({ user, size })` → initials from `firstName`/`lastName` (fallback: first letter of `displayName`), circle, `--portal-nav-active` / `--portal-nav-active-text`, weight 800.
- `DateBlock({ at })` → 44px wide column: weekday 11px muted, day 20px / 800, month 11px muted. Oslo time zone.
- `Skeleton({ width, height })` → `--portal-surface-muted` block, radius 6px, subtle shimmer; no animation under `prefers-reduced-motion`.
- `CardLink({ to, children })` → the "Open ›" style link: 13px / 700 accent with a 14px chevron.

## Step 3 — Home page (`frontend/src/pages/HomePage.tsx` + new `frontend/src/pages/home.css`)

Keep the existing data loading (permissions-gated parallel loads, abort on unmount, 60s `now` tick). Extend it:

- Also load `contactApi.inbox()` for `unreadCount` (same call `AppShell` makes; a second call is acceptable).
- Build **own items** the way the current code does (flights, duty, flyvask where `isCurrentUser`, not CANCELLED/COMPLETED, ends in the future). Drop the 48-hour limit on flyvask: include everything within the next 30 days.

Layout order on phones (single column), desktop in a 2-column grid `minmax(0, 1.55fr) minmax(300px, 1fr)` with left = Up next, This week, Upcoming and right = Brakkevakt, Flights, Inbox:

1. **Greeting block.** `h1`: `Good morning` (Oslo hour < 12), `Good afternoon` (12–17), `Good evening` (≥ 18) + `, {firstName}` (fallback: `displayName`). Sub-line 13px muted: `Wed 30 Sep · Week 40 · Synced 12:04` on phones; `Wednesday 30 September · Week 40` on desktop with the synced control as a ghost button on the right. "Synced" = the newest `sync.lastSyncedAt` across loaded modules, formatted `HH:MM` Oslo. If any source is stale show a warning chip `May be out of date` instead of the time.
2. **Attention.** A row of `Chip`s (tone warning), each a link:
   - `{n} unread in Inbox` → `/inbox` (when `unreadCount > 0`)
   - `Fuel needs review · {callSign}` → `/flights` (existing `fuelAttention` logic)
   - `{module} may be out of date` → module path (existing `staleSources`)
   - Exchange requests waiting on the user, **only if** a cheap summary exists in `features/exchange/v2-api.ts` or the Duty Ops summary logic; otherwise leave it out and note it in the PR.
   When there is nothing: one line, 13px / 600 muted, with a 16px `check-circle` in accent: `Nothing is waiting on you. No exchange requests, no unread messages.` Adjust the sentence to what is actually checked.
3. **This week card.** Title `This week`, aside `Week {n}` (use `weekNumber`). Seven cells Mon–Sun of the current Oslo week: weekday 11px / 700, day number 17px / 800 (15px on phones), a 6px dot below when the user has an own item that day (colour `--portal-accent`). Today's cell: background `--portal-nav-active`, text `--portal-nav-active-text`, `aria-current="date"`. Each cell is a link to the day's first item, or plain text when empty. Under the cells, when Brakkevakt applies this week: an inset bar (`--portal-surface-muted`, radius 8px, 13px / 600, calendar icon in accent) reading `Brakkevakt all week · with {partner}` (own week) or `Brakkevakt this week · {names}` (not own), with a `Schedule ›` link to `/brakkevakt`. Reuse `ownAssignment`, `partner`, `personName`.
4. **Up next card.** The earliest own item (`items[0]`). Eyebrow `UP NEXT · TODAY|TOMORROW|{Thu 1 Oct}`; on the right a chip: `Starts in {n} min` (< 60 min), `Starts in {n} h` (< 24 h), `Starts in {n} days`, or `In progress · ends {HH:MM}` (tone soft) when already started. Title 26px / 800 (22px on phones) = `Duty Ops` / `Flyvask` / `Flight`, followed by a soft chip `Your shift` (`Your flight` for flights). Meta row (14px / 600 secondary, icons 16px muted): calendar `Thu 1 Oct`, clock `08:00–13:00 · 5 h`, users `You + {participantCount − 1} others` (flights: aircraft call sign and lessons instead of people; flyvask: add `classroomName` with the pin icon). Actions: primary `Open shift` (→ the item path; label `Open flight` for flights) and secondary `Exchange` with the `swap` icon (→ the module's exchange start; only when the user has the module's `*.swap` permission). Empty: `EmptyState` with the calendar icon, `Nothing scheduled`, `Your next shift or flight will show up here.`
5. **Upcoming card.** Title `Upcoming`, aside `Next 30 days` (+ `All shifts ›` → `/duty-ops` on desktop). Rows = own items within 30 days, max 6, each a link: `DateBlock`, title 15px / 700, meta 13px muted (`08:00–13:00 · You + 2 others`; flyvask adds `· Hangar UTSA`; flights use the existing detail string), a soft chip (desktop only) and a 18px chevron. Rows are separated by 1px `--portal-border`; 12px vertical padding (10px on phones). Empty: `EmptyState`, calendar icon, `Nothing in the next 30 days`, `Open a module to pick up a shift.`
6. **Brakkevakt card.** Title `Brakkevakt`, aside `Manage schedule ›` when the user has `brakkevakt.manage_schedule`, else `Open ›`. Body: 40px tile with the calendar icon on `--portal-nav-active`, then `Week {n} · this week` / `Mon 28 Sep – Sun 4 Oct · with {partner}` for the current or next own week; otherwise `EmptyState` `No Brakkevakt week assigned`.
7. **Flights card.** Title `Flights`, aside `Open ›`. When there are upcoming flights, list the next two as compact rows; otherwise `EmptyState` with the plane icon: `No flights in the next 4 weeks`, `Synced {HH:MM} from FlightLogger`.
8. **Inbox card.** Title `Inbox`, aside `Open ›`. `{n} unread` with the newest item's title when `unreadCount > 0`; otherwise `EmptyState`, inbox icon, `You're all caught up`, `Exchange requests and notices show up here`.

Loading: while the first load is pending, render skeletons for the greeting sub-line, Up next (3 lines + 2 button blocks) and three Upcoming rows. Partial failures keep the existing `errors` message at the bottom of the page.

Remove the old `home-schedule` / `home-day` / `home-week` / `home-context` markup and CSS once nothing else uses them (grep first).

## Step 4 — Mobile shell (`frontend/src/app/AppShell.tsx` + `portal.css`, `≤ 900px` only)

- Header: height 56px, background `--portal-background`, border-bottom 1px `--portal-border`, no navy. Left: brand mark 32px + `Luftfartsfag` 16px / 800 (hide `Studentportal`). Right: bell 40×40 (when `unreadCount > 0` show an 8px accent dot at the top right and include the count in `aria-label`), then the account button as a 34px `Avatar`. The account button keeps `className="current-user"`, `aria-expanded`, `aria-controls="account-menu"` and the existing outside-click/Escape behaviour (tests rely on them); on ≤ 900px it shows only the avatar, on desktop it stays as it is.
- Bottom nav: items 52px tall, radius 12px, icon 20px, label 11px / 700, gap 3px; active item background `--portal-nav-active`, text `--portal-nav-active-text`; bar background `--portal-surface`, border-top `--portal-border`, padding `6px 8px calc(10px + env(safe-area-inset-bottom))`.
- `theme-color` meta on phones: keep the current bootstrap in `index.html` (navy for light, `#0b161c` for dark). It matches the desktop header; on phones it now sits above a light header, which is acceptable for this PR.
- Desktop (> 900px): keep the navy header and sidebar exactly as they are.

## Step 5 — Tests

- Update `frontend/test/home-duty-ops.test.tsx` for the new markup (it renders `HomePage` with fake timers at `2026-09-27T08:00:00Z`; keep its intent: own duty shift shows, cancelled/other people's shifts do not).
- Add `frontend/test/home-redesign.test.tsx` covering: greeting by hour (three cases, Oslo time); up-next picks the earliest own item across duty, flyvask and flights; the `Starts in … h` / `In progress` chip; the week strip has 7 cells and today carries `aria-current="date"` and a dot on the right day; attention chips render with `unreadCount` and the all-clear line otherwise; skeletons render before data resolves; empty states render with no data.
- Add `frontend/test/ui.test.tsx` for `Avatar` initials (two names, one name, none) and `Chip` tones.
- `portal.test.tsx` and `settings-navigation.test.tsx` must stay green without edits, apart from the icon name type if you renamed nav icons.

## Step 6 — Verify, then PR

1. `npm run check && npm --prefix frontend test && npm test && npm run build` — all green.
2. Run the app locally (above) and take screenshots at 390×844 light and dark and at 1366×900. Compare against `docs/mockups/home-phone-*.html`. Zero console errors.
3. Check contrast of any new colour pair in both themes (all existing pairs already pass AA).
4. Commit in small steps (foundations, UI pieces, Home, shell, tests). Push the branch, open a PR into `develop` titled `Redesign Home for mobile`, with: what changed, screenshots described (or attached if the tooling allows), the Step 2 exchange-summary decision, and the font hosting decision.

## Acceptance checklist

- [ ] Manrope loads offline (precached) and there is no layout jump on reload.
- [ ] Phone Home matches the mock-up: greeting, attention, week strip, Up next, Upcoming, Brakkevakt, Flights, Inbox, in that order.
- [ ] Bottom nav and mobile header match the mock-up; the account menu still opens, closes on Escape and outside click.
- [ ] Desktop Home uses the same cards in the 2-column grid; the desktop header and sidebar are unchanged.
- [ ] Dark mode looks right on every card, chip and empty state.
- [ ] No hard-coded colours outside `tokens.css`; no new dependencies; backend untouched.
- [ ] All tests pass; new tests cover greeting, up-next selection, week strip, attention and empty states.
