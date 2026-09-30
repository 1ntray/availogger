# Duty Ops redesign brief (mobile first)

Implementation script for the approved Duty Ops mock-up. Follow it top to bottom. It builds on the Home redesign (#58): reuse `app/ui.tsx` (`Card`, `Chip`, `EmptyState`, `Avatar`, `DateBlock`, `Skeleton`, `CardLink`), `app/ui.css`, the tokens in `tokens.css`, `.ui-button`, and `Icon`.

Reference mock-ups (static HTML; open the phone ones at 390px wide):

- `docs/mockups/duty-phone-light.html`, `docs/mockups/duty-phone-dark.html`: the target for the Schedule tab.
- `docs/mockups/duty-phone-exchange.html`: the same page when an exchange is waiting on the user.
- `docs/mockups/duty-desktop-light.html`: desktop direction. Only the **content area** applies; the desktop shell is out of scope, as for Home.

The mock-ups use real times and head counts from one account (Wed 30 Sep 2026, 16:17 Oslo). Names in `[brackets]` are placeholders.

## Ground rules

- Branch `feature/duty-ops-redesign` (this file lives on it). Open a PR into `develop`, and never push to `master`.
- Frontend only: `frontend/`. Do not touch `backend/`, `functions/`, `migrations/`, `shared/`, `wrangler*.jsonc`, workflows or Access configuration.
- **Exchange behaviour does not change.** `ExchangeShiftActions`, `DutyExchanges`, `ExchangeV2Provider`, `ExchangeV2Summary` and everything under `features/exchange/` hold the exchange rules: give-away, offers, credits, locks, and legacy v1 together with v2. Move and restyle their output; never rewrite their logic, change their API calls or drop a state they render. The exchange-centre view (`center`) keeps its current content.
- `dutySections` (`features/duty-ops/presentation.ts`) stays as it is, so completed and cancelled shifts stay hidden. The faded "Completed" row in the mock-up is illustrative; do not add past shifts.
- No new runtime dependencies. No hard-coded colours: every colour is a `var(--portal-…)` token. It must look right in both themes.
- Accessibility carries over: 44px touch targets on phones, visible focus, labels on icon-only controls, text contrast ≥ 4.5:1 in both themes, and meaning never carried by colour alone.
- Before pushing, all of these must pass: `npm run check`, `npm --prefix frontend test`, `npm test`, `npm run build`.

## Local run (for screenshots)

This is the same as the Home brief (`docs/home-redesign-brief.md`, "Local run"). `npm run dev` does not work with the pinned Wrangler, so run `wrangler pages dev` from a separate folder where `wrangler.local.jsonc` is copied as `wrangler.jsonc`. Never run it against the root `wrangler.jsonc`, which holds production IDs. The first visit needs a FlightLogger API key: ask the user for one and paste it into the onboarding form. Take screenshots at 390×844 in light and dark, and at 1366×900.

## Step 0: name codes (three letters)

The students identify each other by three-letter codes: the **first letter of the first name** plus the **first two letters of the last word of the last name**.

- Mike Myers → **MMY**
- Chris Hems Dal → **CDA**
- Ole Markus Rockstad → **ORO**

Two-letter initials are not enough because some students share them.

- In `frontend/src/app/ui.tsx`, change `initials()` to `nameCode()`. Keep an `initials` export as an alias until nothing uses it, then remove it.
  - `first = firstName.trim().split(/\s+/)[0]`; `lastWord = lastName.trim().split(/\s+/).at(-1)`.
  - Code = `first[0] + lastWord.slice(0, 2)`, upper-cased with `toLocaleUpperCase('nb-NO')` so æ/ø/å work.
  - No last name: the first three letters of the first name. No first name: the first three letters of the last word. Neither: the first letter of the email. Nothing at all: `?`.
- `Avatar` shows the code. At 32–34px use a font size of about 0.32 × size with letter-spacing .02em, so three letters fit.
- Update `frontend/test/ui.test.tsx` with these cases:
  - Ole Markus Rockstad → ORO
  - Mike Myers → MMY
  - Chris / Hems Dal → CDA
  - Åse / Øvre Ås → ÅÅS
  - single first name
  - missing names with an email
  - nothing → ?

## Step 1: the people on a shift

`DutyShift.participants` contains only students who have signed in to Studentportal; each has a name. `participantCount` also counts students who come from FlightLogger but have not signed in yet. They have no name in the app until they sign in.

Add `PeopleStack` to `app/ui.tsx` (styles in `ui.css`). Props: `{ people: { firstName, lastName, isCurrentUser }[]; total: number; size?: 22 | 26; withLabel?: boolean }`.

- **Signed-in people:** a pill each, showing the name code.
  - Height = size; padding 0 7px; radius 999px; 11px / 800; letter-spacing .04em.
  - Other people: `--portal-nav-active` background with `--portal-nav-active-text`.
  - The current user: `--portal-accent-fill` background with `--portal-on-accent`.
  - Show the current user first. No overlap, gap 4px.
- **Not signed in** (`total − people.length`, never negative): a dashed circle each, `(size − 2)`px, with a 1px dashed `--portal-muted` border, a `--portal-surface-muted` background and the `account` icon at half size in muted colour. Show up to 3 in total; beyond that, add a neutral `Chip` reading `+N`.
- **Accessible name:** set `aria-label` on the wrapper to the label below. The pills and dots are `aria-hidden`.
- **Label** (visible only when `withLabel`): reuse the wording from `participantLabel` in `features/duty-ops/presentation.ts`, with "You" for the current user.
  - `You · Anna Berg · 1 other`
  - `3 students`
  - Refactor `participantLabel` to take an optional current-user flag rather than duplicating it.

## Step 2: page structure (`frontend/src/pages/DutyOpsPage.tsx`)

Keep the data loading, the `reload` counter, the 60s `now` tick and the `OnboardingRequiredError` handling exactly as they are. Keep `ExchangeV2Provider` and `DutyExchanges` wrapping the content; the cards below live inside them so `ExchangeShiftActions` keeps its context.

1. **Title block.** Replace `PageHeader` + `RefreshControl` + the "Sync details" `<details>`:
   - `h1` "Duty Ops" (22px / 800 on phones, 28px on desktop).
   - Sub-line, 13px / 600 muted: `Synced HH:MM · 60 days from FlightLogger`.
     - HH:MM is `sync.assignments.lastSyncedAt` in Oslo time.
     - Derive the day count from `data.from` / `data.to` rather than hard-coding 60.
     - Put the full "Schedule: … · Assignments: …" ages from `cacheAgeLabel` in the sub-line's `title` attribute so they stay available.
   - On the right, a refresh button: 40×40 icon-only on phones with `aria-label="Refresh Duty Ops"`, and icon + "Refresh" on desktop. It is disabled while loading and increments `reload`.
   - Keep the existing stale warning (`AttentionDetail`, "Schedule may be out of date") and the error alert directly under the title block.
2. **Tabs** (`nav aria-label="Duty Ops sections"`). These are links to existing routes, with no new state:
   - **Schedule** → `/duty-ops`
   - **Exchanges** → `/duty-ops/exchanges`. Only shown with `duty_ops.swap`, which that route already requires.
   - **Activity** → `/activity?module=duty-ops`
   - Styling: a segmented control in `--portal-surface-muted` with 4px padding and radius 10px. Each item is 36px high (44px hit area on phones), 13px / 700.
   - The active item has a `--portal-surface` background, `--portal-shadow-card` and `aria-current="page"`.
   - Exchanges shows a small warning badge with the number of items that need the user's answer, when that number is above 0 (see step 4). Render the tabs inside the provider so the count is available.
   - This replaces the `BackLink` on the exchange-centre page: both views show the tabs, and "Exchanges" is active on `/duty-ops/exchanges`.
3. **Schedule tab order on phones:** On duty now (only when there is a shift on duty now) → Your shifts → Exchanges → Schedule. **When the user has something to answer** (step 4), put the Exchanges card directly after On duty now, as in `duty-phone-exchange.html`.
4. **Desktop (> 900px):** a 2-column grid, `minmax(0, 1.55fr) minmax(320px, 1fr)`, gap 24px. Left: Schedule. Right: On duty now, Your shifts, Exchanges.
5. **Exchanges tab** (`view === 'exchanges'`): same title block and tabs, then the existing exchange-centre content inside a `Card`. Restyle only its section headings (`h3` → 13px / 800 muted uppercase eyebrow) and rows (see step 5, "Exchange rows").

## Step 3: cards (new `frontend/src/features/duty-ops/duty-ops.css` rules; replace the old `.duty-row`, `.duty-summary` and `.duty-schedule` styles once unused)

1. **On duty now:** one card per shift in `sections.onDutyNow`.
   - Top row: an eyebrow "ON DUTY NOW" with a 7px live dot (`--portal-accent`, 3px `--portal-nav-active` ring) on the left. On the right, `Ends in N min` / `Ends in N h` (13px / 700 accent).
   - Middle: the time range at 24px / 800, tabular and `white-space: nowrap`, with `PeopleStack withLabel size=26` wrapping below it on narrow screens.
   - Bottom: a 6px progress bar with `role="progressbar"`, `aria-valuenow` = the percent elapsed and `aria-label="Shift progress"`. Track `--portal-divider`, fill `--portal-accent`, no animation.
   - If the shift is the user's, add a `Your shift` soft chip and the `ExchangeShiftActions` output.
2. **Your shifts:** `sections.mine`. Card title "Your shifts", aside `Next N days`. For each shift:
   - An inset block (radius 10px, `--portal-highlight` background) with `DateBlock`, the time range (16px / 800) and a relative chip: `Today`, `Tomorrow` (tone warning), or none.
   - Under the time, the duration (`5 h`).
   - Below the block, `PeopleStack withLabel size=26`.
   - Actions row: primary `Open shift` → `/duty-ops/shifts/:id` (the existing link and its `aria-label`), then the `ExchangeShiftActions` output restyled per step 5.
   - Separate multiple shifts with a divider.
   - Empty: `EmptyState` (calendar icon) with `No upcoming shifts` / `Pick one up from Exchanges.` (the second line only with `duty_ops.swap`).
3. **Exchanges card:** title "Exchanges", aside `CardLink` "Exchange centre" → `/duty-ops/exchanges`. Only shown with `duty_ops.swap`.
   - **Three stat tiles** in a `repeat(3, minmax(0, 1fr))` grid: **Available**, **Requests**, **Needs review**. Each tile is radius 10px on `--portal-surface-muted`, with the number at 22px / 800 tabular and the label at 12px / 700 muted. Each tile links to the exchange centre.
     - "Needs review" > 0 uses the warning background and text colours.
   - **Counts:** take them from the lists `ExchangeV2Summary` already computes (`available`, `mine`, `review`) plus the legacy opportunities (`useLegacyOpportunities`). Expose them by adding an optional `render` prop (or a small `useExchangeCounts(domain)` hook in `ExchangeV2.tsx`) that returns `{ available, requests, review }` from the same arrays. Do not add requests.
     - **Available** = `available.length + legacy.length`
     - **Requests** = the user's own active intents (`mine.length`)
     - **Review** = `review.length`
     - The same `review` number drives the tab badge.
   - **Needing an answer:** under the tiles, the existing preview rows (`IntentRow preview`, `CandidateRow`, legacy rows) restyled per step 5. Put the items that need the user's answer first.
   - **Credit line:** a divider, then `coins` icon + `Credit balance {creditSign(balance)}` + `Activity ›` → `/activity?module=duty-ops`. The balance comes from `loadCreditSummary` (`features/duty-ops/credit-api.ts`); `DutyExchanges` already loads it, so pass it up through its `onBalanceChanged` prop rather than making a second request if possible. Hide the line when the balance is unknown.
4. **Schedule card:** title "Schedule", aside `Times in Oslo`. `sections.schedule` grouped by day.
   - **Day header:** 13px / 800 label + 12px / 600 muted date. The label is `Today`, `Tomorrow`, else the weekday name (`Friday`); the date is `Fri 2 Oct`, with the year added when it differs from this year. Separate groups with a 1px `--portal-border` divider.
   - **Row** (min-height 44px, padding 8px 10px, radius 10px, bleeding 10px into the card padding):
     - A 48px time column: start at 15px / 800, end at 12px / 600 muted, tabular.
     - `PeopleStack size=22` without a label (the label is its `aria-label`).
     - A status chip: `Your shift` (soft) for own shifts, `On now` (soft, with the live dot) when in progress, `Cancelled` / `Partially completed` (neutral) where they still appear.
     - The existing `ExchangeShiftActions` output for that shift (for example `Swap wanted by …`, `Take shift · +1 credit`, `Offer a shift`) on its own line under the row when present.
     - Own shifts get the `--portal-highlight` row background and a trailing chevron. The row links to `/duty-ops/shifts/:id` only for own shifts (as today); other rows are not links and have no chevron.
   - Keep `AttentionDetail` "Assignments differ from FlightLogger" on rows where `assignmentsDiffer`.
   - Empty: `EmptyState` with `No shifts in the next N days`.
5. **Loading:** on first load, skeletons for the title sub-line, one Your-shifts block and four schedule rows. They replace "Loading Duty Ops…"; keep `role="status"` with `aria-label="Loading Duty Ops"`.

## Step 4: "needs your answer"

When `review > 0`:

- The Exchanges tab gets its badge.
- On the Schedule tab, the Exchanges card moves up, directly after On duty now.
- The Home attention strip can now show `Exchange needs your answer` → `/duty-ops/exchanges` (warning chip). Home already loads Duty Ops but not exchange data, so do this **only if** the counts hook from step 3.3 can be used on Home without the full `ExchangeV2Provider`. Otherwise skip it and say so in the PR.

## Step 5: exchange rows (restyle only)

Wrap the output of `IntentRow`, `CandidateRow`, the legacy rows and `ExchangeShiftActions` in the new look, without changing which buttons appear or what they do:

- **Row container:** radius 10px, 1px `--portal-border`, padding 12px, gap 10px.
- **Status line:** a `Chip`, using warning for anything that needs the user's answer (`Needs your answer`, `Review offers`) and neutral otherwise (`Offer sent`, `Give-away posted`, `Looking for swap`). Put the relative time on the right when the data has one.
- **Swaps:** when a row describes a swap with both sides known, show two inset boxes, `YOU GIVE` and `YOU GET` (11px / 700 muted labels), each with the date and time, and a `swap` icon between them. This is the `exchangeAssignmentLabel(...)` text split into date and time.
- **Buttons:** `ActionButton` / buttons become `.ui-button` at 36px (44px on phones). Accept, Confirm and Take shift are `--primary`; Decline, Cancel and Withdraw are the default style. Keep the existing labels, `disabled` states and handlers.
- **Credits:** keep `Take shift · +1 credit` and the balance hints in the give-away dialog as they are.

## Step 6: tests

- Update the Duty Ops tests to the new markup. Keep every current intent; do not delete assertions about exchange behaviour.
  - Relevant files: `duty-ops.test.tsx`, `duty-ops-swaps.test.tsx`, `duty-ops-effective-assignments.test.tsx`, `duty-ops-credits.test.tsx` and `exchange-v2.test.tsx`.
  - Where a test queried `.duty-row` or the "Sync details" text, move it to the new equivalents.
- Add `frontend/test/duty-ops-redesign.test.tsx`:
  - The tabs render with the right `href`s. Exchanges is hidden without `duty_ops.swap`, and `aria-current` is on the right tab on both routes.
  - On duty now shows `Ends in 43 min` and `aria-valuenow="82"` for a 13:00–17:00 shift at 16:17 Oslo.
  - `PeopleStack`: 3 participants with 1 signed in gives one pill (with its code) and two dashed dots. Its `aria-label` is `Anna Berg · 2 others`, or `3 students` when nobody is signed in. The current user's pill comes first and is marked.
  - Schedule groups have the headers `Today` / `Tomorrow` / weekday. Own rows link to the shift page; others do not.
  - The Exchanges stat tiles show the counts from mocked exchange data. The tab badge appears with review > 0, and the card moves up.
  - The credit line shows `+1` / `0` / `-2` via `creditSign`.
  - Skeletons show before data arrives.
- `ui.test.tsx`: name-code cases (step 0) and `PeopleStack` rendering.

## Step 7: verify, then PR

1. Run all four checks (Ground rules); every one must pass.
2. Run locally and screenshot 390×844 in light and dark, plus 1366×900. Compare against `docs/mockups/duty-*.html`. There must be no console errors.
3. Check the exchange centre (`/duty-ops/exchanges`) still works end to end in the UI: open the start-exchange dialog on your own shift and cancel it. **Do not submit exchanges against the production or shared preview data.**
4. Commit in small steps: name codes, PeopleStack, page structure and tabs, cards, exchange restyle, tests.
5. Open a PR into `develop` titled `Redesign Duty Ops for mobile`. In it, describe what changed, which exchange rows were restyled, the step 4 Home-chip decision, and anything in this brief you could not follow and why.

## Acceptance checklist

- [ ] Name codes are three letters everywhere (Home avatar, account button, Duty Ops pills), with sensible fallbacks.
- [ ] Phone Schedule tab matches `duty-phone-light.html` / `duty-phone-dark.html`. With something to answer it matches `duty-phone-exchange.html`.
- [ ] Tabs work on both routes; Exchanges is hidden without the swap permission.
- [ ] Students who have not signed in show as dashed dots and are counted; signed-in students show their code.
- [ ] Every exchange action that worked before still appears and works, and the exchange centre content is unchanged apart from styling.
- [ ] Desktop uses the 2-column layout; the desktop shell is unchanged.
- [ ] No hard-coded colours, no new dependencies, and nothing outside `frontend/` changed.
- [ ] All tests pass, and the new tests cover tabs, on-duty progress, PeopleStack, schedule grouping, exchange counts, the credit line and loading.
