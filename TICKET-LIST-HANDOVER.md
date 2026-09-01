# Ticket list — handover

Work done 2026-09-01. Ticket search rebuild + P0 (1–3) and P1 (4–5) of the ticket-list audit.
**Remaining: P1 items 6, 7, 8, 9; P2 mobile; the new filters.**

---

## 1. Read this first — environment facts

- **Test files are gitignored.** `.gitignore:33` is `**/*.test.js`. Every test file below is
  untracked. `git stash` will not stash them, and a stash of a source file will break its
  tests until popped. This burned two verification runs.
- **Frontend baseline: `cd frontend && npx vitest run` → 46 failed / 425 passed.**
  All 46 are pre-existing, from other uncommitted work in the tree — `TeamsPage`,
  `TicketComments`, `ProjectsPage`, `api-error` (estimate date messages),
  `board-permissions`, and `BoardPage` (renders without `TicketPreferencesProvider` and
  does not mock it). Verified by A/B against a revert. **Do not chase them.**
- **Backend baseline: `cd backend && node --test "src/modules/tickets/__tests__/*.test.js"`** —
  pre-existing failures in attachment / comment / transition / external-auth. `ticket.list.test.js`
  itself is 42/42.
- **Next 15 + React 19.** `window.history.pushState/replaceState` sync with `useSearchParams`
  in the App Router — confirmed in the Next docs, and the ticket page now depends on it.
  Do not reintroduce `useRouter` here; one mechanism only.
- **`vi.restoreAllMocks()` wipes `vi.fn()` implementations** (not just spies). The ticket page
  test restores its three history spies individually instead. Don't "tidy" that back.

---

## 2. What was already done

### Backend — ticket search (replaced `$text`)

`backend/src/modules/tickets/ticket.service.js`

- `ticketSearchClause(raw)` — exported, ~line 260. Number branch (`ID_SHAPE`) anchors both
  ends so `WEB-63` / `web63` / `web 63` / `63` all resolve exactly; word branch ANDs up to
  6 escaped substrings across `title`, `module`, `ticketId`.
- **Never searches `description`** — that was the source of the false positives.
- Composed as `filter.$and = [...(filter.$and ?? []), search]`, never `filter.$or`, so RBAC
  visibility / project scope / pagination / counts are untouched.
- The `{ title: 'text', description: 'text' }` index at `ticket.model.js:176` is now unused but
  **left in place**: deleting the schema line does not drop the live Atlas index, so removing it
  would create code/DB drift. Dropping it is a deliberate ops step.
- Ceiling: the word branch is an unanchored regex = collection scan. Fine to ~50k tickets.
  Upgrade path is Atlas Search `autocomplete` — **not** now: `$search` must be the first
  aggregation stage, which would push the RBAC filter to run *after* the match.
- 18 tests in `backend/src/modules/tickets/__tests__/ticket.list.test.js`.

### Frontend — P0 1/2/3 and P1 4/5

| File | What changed |
|---|---|
| `frontend/app/(app)/tickets/page.jsx` | rewritten: URL-as-view, debounce, abort, owner validation, history-aware drawer |
| `frontend/shared/lib/ticket-list-query.js` | `staleProjectFilters`, `pageFromSearch`, `limitFromSearch`, `withPageParam`, `hasFilterParams`, `filtersFromSearch`, `withFilterParams`, `resolveViewFilters`, `TICKET_PAGE_SIZES`, `qOverride`/`limitOverride` |
| `frontend/shared/lib/use-debounced-value.js` | new, 12 lines |
| `frontend/shared/api/client.js` | `ABORTED` error branch + exported `isAbortError` |
| `frontend/shared/api/tickets.js` | `listTickets(params, options)` — additive, for the signal |
| `frontend/shared/contexts/ticket-preferences-context.jsx` | `page`/`setPage` removed — the URL owns page now |

Tests: `frontend/shared/lib/ticket-list-query.test.js` (26),
`frontend/shared/lib/use-debounced-value.test.js` (4),
`frontend/app/(app)/tickets/__tests__/ticket-list-state.test.jsx` (25).

**Decisions already made — do not relitigate:**

- `ownerOptions` is tri-state. `null` = unresolved (loading, or `getProject` failed);
  `[]` = resolved-empty (All Projects, or a project with no members). Clearing a filter on
  `null` would wipe it on every page load. This distinction is the whole fix for P0 #1.
- `queryFilters` is keyed by **serialized value**, not object identity
  (`queryKey` → `JSON.parse`). Every keystroke produces a fresh `preferences` object; an
  identity-keyed memo refetched regardless of the debounce, i.e. the debounce did nothing.
  If you touch that memo, keep it value-keyed.
- URL filter precedence is **all-or-nothing**: if the URL names any filter, it wins for all of
  them. Merging would show a shared link's recipient a view its sender never had.
- A filter change writes the URL **and** persists to preferences, so the two cannot drift.
  Opening someone else's link does **not** touch your saved defaults.
- `/tickets` normalizes itself once on load, writing saved filters into the URL. Without it,
  copying the address bar after a normal load shares the wrong list.
- Drawer close: `history.back()` only when the view behind the drawer is unchanged since we
  pushed (`drawerOpenedFrom` ref holds the search string, not a boolean). Otherwise
  `replaceState`, so a deep link doesn't exit the site and a page change made behind the
  drawer isn't discarded.

**Known gap:** sort is **not** in the URL, so a shared link shows the recipient *their* sort
order. Deliberate scope call. It is a 3-line addition to `URL_FILTER_KEYS` handling in
`ticket-list-query.js` if wanted — see item 9 below, they pair well.

---

## 3. Remaining work

### P1 #6 — dynamic empty state  (small)

`frontend/shared/components/tickets/ticket-table.jsx:50-56` hardcodes
"Clear the stage or scope filter first", which is wrong whenever the narrowing filter was
the search box or the owner.

- Pass the active filters (and `onReset`) into `TicketTable`, or lift the empty state into
  `page.jsx` where `viewFilters` and `handleReset` already live. **Prefer lifting** — the
  table shouldn't grow filter knowledge.
- Render the active filters by name: `Search: administrator`, `Priority: Urgent`, `Blocked`.
- Put the reset button in the empty state. `handleReset` in `page.jsx` already clears both
  the URL and the stored defaults.
- `hasActiveTicketFilters(filters)` already exists in `shared/ticket-preferences.js:72` —
  reuse it, don't write a second one. Consider adding a sibling
  `activeTicketFilterLabels(filters)` there so it is unit-testable without React.

### P1 #7 — background loading  (small)

`page.jsx` currently shows the loader only when `loading && listPage.results.length === 0`;
otherwise stale rows sit fully opaque with no cue.

- Keep the rows, add a subtle busy state when `loading` and results exist — e.g. a
  `.tablewrap[data-busy]` opacity/`aria-busy` treatment in `design-system.css`.
- Must respect `prefers-reduced-motion` if you animate it.
- Do **not** blank the table — that flicker is why the current guard exists.

### P1 #8 — numbered pagination + page size  (medium)

Most of the plumbing is already in place:

- `TICKET_PAGE_SIZES = [25, 50, 100]` and `limitFromSearch(search, fallback)` exist and are
  tested. `?limit=50` is already **read** and honoured; nothing **writes** it yet.
- `.pagebtn[aria-current="page"]` styling already exists at `design-system.css:691` and is
  currently unused — it was designed for this and never built.

To do:
- Add a page-size `<select>` to the pager; on change write `limit` to the URL **and** reset
  page to 1. Follow `applyFilters` in `page.jsx`: build on `window.location.search`, write via
  `writeSearch`, persist to preferences via `patchPreferences({ limit })`.
  Note `withPageParam` and a new `withLimitParam` should compose, exactly like
  `withPageParam(withFilterParams(...), 1)` does today.
- Numbered buttons: `‹ Prev 1 2 3 … 10 Next ›`, `aria-current="page"` on the current one.
  Keep it dumb — a windowed range around `page`, no library.
- API caps `limit` at 100 (`ticket.validation.js`), so 100 is the top option. `limitFromSearch`
  already rejects anything not in the list.

### P1 #9 — remove the invisible third sort state  (small)

`shared/ticket-preferences.js:58` `cycleTicketSort` currently goes desc → asc → **none**, and
"none" silently falls back to the server default `createdAt:desc`, which is not one of the six
sortable columns — so the list reorders into something no header can explain.

- **Agreed behaviour: `desc → asc → desc`.** Delete the `{ column: null, direction: null }`
  branch.
- One caller only: `frontend/app/(app)/tickets/page.jsx:245`. No backend impact —
  `buildTicketListSortBy` just always returns a value now.
- Add a case to `shared/__tests__/` for the two-state cycle.
- Good moment to also put sort in the URL (the gap noted above): `sortBy` is already a single
  string from `buildTicketListSortBy(sort)`, so it is one more key in `withFilterParams` /
  `filtersFromSearch` plus reading it in `resolveViewFilters`.

### P2 — mobile  (deferred, agreed)

13px inputs (iOS zoom-on-focus), 30px controls, 26px pager buttons, an 11-control wrapping
toolbar at 375px. Agreed approach when it comes up: collapse Filters/Search/Sort into a
dedicated filter surface on small screens and leave the desktop table alone. The table's
`min-width:940px` inside `overflow-x:auto` is the correct pattern — **do not touch it**.

### New filters — after the state model, not with it

Order agreed: get the list state reliable first (done), then **severity + module**, then
**stage age**. Do not bundle them into one change.

1. **Severity, module, label, team** — already accepted by `listTicketsSchema`
   (`backend/src/modules/tickets/ticket.validation.js:11-29`) and already handled in
   `buildTicketFilter`. **UI only.** For module use the existing module catalog
   (`shared/module-catalog.js` / `frontend/shared/lib/project-modules.js`), not a second list.
   Remember to add each new key to `URL_FILTER_KEYS` in `ticket-list-query.js` so it is
   shareable, and to `hasActiveTicketFilters` in `shared/ticket-preferences.js`.
2. **Stage age ("in stage > N days")** — needs backend. Highest-value next filter for a
   pipeline tool. `stageAgeDays` is already computed client-side in `ticket-table.jsx`.
3. Then: `createdBy`, `testedBy` (gives a QA queue — the one you were most interested in),
   `environment`, `category` (both on the model and in `shared/enums.js`, neither in
   `listTicketsSchema` yet), date ranges, has-attachments, has-unread-comments.

**Whatever you add, keep it inside the single `find` filter.** The security property being
protected is that RBAC visibility, project scope, filters, search and pagination all resolve in
one authoritative backend query.

---

## 4. Verification checklist for the next change

```bash
cd frontend && npx vitest run                      # expect 46 pre-existing failures, nothing new
cd backend  && node --test "src/modules/tickets/__tests__/ticket.list.test.js"   # 42/42
npx eslint <changed files>                         # clean except a pre-existing
                                                   # `_authRetry` unused in shared/api/client.js
```

If a new failure appears in a file you did not touch, A/B it before assuming it is yours:
revert your hunk in place (not `git stash` — the tree has other uncommitted work) and rerun.
