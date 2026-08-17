# Design System

Documents the actual visual language of PROWPLUS as implemented in
`frontend/app/design-system.css` (~2,270 lines, one global stylesheet, imported via
`globals.css` in `app/layout.jsx`). This is the CURRENT system — nothing here is aspirational.

## 1. Styling approach: mixed

Two systems coexist:

- **`design-system.css`** — hand-written CSS custom properties + component classes (`.btn`,
  `.card`, `.drawer`, `.form-row`, …). This is the primary, older system and covers the large
  majority of the app: shell, tickets board/drawer/table, teams pages, forms, dialogs,
  analytics, auth.
- **Tailwind** (`@tailwindcss/postcss`, `tailwindcss` v4) — present but confined to ~12 files,
  mostly the shadcn/ui-derived sidebar primitives (`shared/components/ui/sidebar.jsx`,
  `ui/sheet.jsx`, `app-sidebar.jsx`) and a handful of newer surfaces (`teams/page.jsx`,
  `teams/team-form.jsx`, `tickets/analytics/page.jsx`, `tickets/new/page.jsx`,
  `tickets/[id]/edit/page.jsx`, `tickets/stats-strip.jsx`, `tickets/ticket-metadata-rail.jsx`,
  `tickets/ticket-table.jsx`, `projects/page.jsx`, `projects/new/page.jsx`).

**When building a new page or component, check which system the surrounding code already
uses and match it** — don't introduce Tailwind classes into a design-system.css-styled page
or vice versa. Unknown / needs confirmation: whether the team intends to migrate fully to
Tailwind over time, or keep the split permanently.

## 2. Color tokens

Defined as OKLCH custom properties on `:root`, redefined under
`@media (prefers-color-scheme: dark)` and under explicit `[data-theme="light"|"dark"]`
attribute selectors — full light/dark theming, toggled by `theme-toggle.jsx`.

| Token | Role |
|---|---|
| `--paper` | page background |
| `--panel`, `--panel-2` | raised surface / nested surface |
| `--rule`, `--rule-soft` | borders — normal and low-contrast |
| `--ink`, `--ink-2`, `--ink-3` | text — primary, secondary, tertiary/muted |
| `--sig`, `--sig-hi`, `--sig-ink`, `--sig-wash`, `--sig-line` | brand/accent — base, hover, on-accent text, tint background, tint border |
| `--alarm`, `--alarm-wash` | destructive / error / overdue |
| `--shadow-drawer`, `--shadow-pop` | elevation for the drawer and popovers/menus |

Legacy aliases also exist for older component code: `--muted` (`--ink-3`), `--danger`
(`--alarm`), `--border` (`--rule`), `--primary` (`--sig`), `--primary-soft` (`--sig-wash`).

**Auth pages run a separate, theme-independent dark palette** (`--au-*` tokens, defined once
on `:root` with no light variant) — comment in the CSS explains this is deliberate: the
signed-out surface has nothing to alt-tab to and stays fixed regardless of the app's
light/dark setting.

## 3. Typography

- Font stacks: `--ui` (system sans stack) for body text, `--mono` (system mono stack, e.g.
  Cascadia Mono / SF Mono / JetBrains Mono) for IDs, numbers, timestamps, code.
- Base body: `13.5px`, `line-height:1.45`, `letter-spacing:-0.011em`.
- Headings: `h1` 1.5rem/700, `h2` 1.125rem/600, `h3` 0.9375rem/600 — all `letter-spacing:-0.022em`.
- `.lbl` — the one field-label vocabulary used everywhere: `0.6875rem`, weight 600,
  `letter-spacing:0.055em`, uppercase, `--ink-3`.
- `.meta` (0.75rem, `--ink-2`) and `.dim` (`--ink-3`) for secondary/muted inline text.
- `.num` / `.mono` utility classes force tabular numerals for aligned figures.

## 4. Spacing, radius, shadow

- No formal spacing scale variable (`--space-*`) exists — spacing is ad hoc per component
  (mostly 4/6/8/10/12/14/16/20/24px). Unknown / needs confirmation: whether a token scale is
  planned.
- Radius: `--r: 4px` (default — buttons, inputs, chips), `--r-lg: 6px` (cards, panels, dialogs,
  drawers-adjacent surfaces). Avatars and toggle chips use `50%` / `999px` (pill) directly.
- Elevation: `--shadow-drawer` (side panel) and `--shadow-pop` (menus, popovers, dialogs) are
  the only two shadow tokens; both are a 1px ring plus a soft directional blur, not a generic
  box-shadow scale.
- `--bar-h: 48px` is the single fixed height for the top bar / brand strip.

## 5. Component patterns actually in use

| Pattern | Classes | Notes |
|---|---|---|
| Button | `.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.btn-sm`, `.btn-ico`, `.btn-spin` | 30px tall default, 26px `.btn-sm`; disabled via `[disabled]` opacity, not a separate class |
| Input / select / textarea | `.form-row input/select/textarea`, `.dlg .form-row …` | 34px (page forms) or 40px (dialogs) tall; focus = `--sig` border + `--sig-wash` glow ring |
| Card (data card) | `.card`, `.card-top`, `.card-id`, `.card-flags`, `.card-foot` | used on the ticket board |
| Panel (generic box) | `.panel` | analytics/stat blocks |
| Table | `table` + `.tablewrap`, `thead th.sortable`, `.pager`, `.selbar` | sortable headers via `aria-sort`; `.dense` modifier tightens row padding |
| Modal / dialog | `.dscrim`, `.dlg`, `.dlg-head`, `.dlg-body`, `.dlg-foot` | reserved for confirmation + one short form only — CSS comment: "anything longer is a page, because a modal cannot be linked to or reopened" |
| Drawer (side panel) | `.scrim`, `.drawer`, `.drawer-head`, `.drawer-body`, `.drawer-foot`, `.tabs`/`.tab` | slide-in from the right, used for ticket detail |
| Popover / dropdown menu | `.menuwrap`, `.menu`, `.menuitem`, `.menusep` | positioned absolute, `.menu.on` toggles visibility |
| People-picker popover | `.member-picker`, `.mp-*` | deliberately NOT built on `.menu` — CSS comment explains it needs its own header/footer/scroll flex layout that `.menu`'s `display:block` would fight |
| Chip / badge | `.chip`, `.chip-p1`/`.chip-p2`/`.chip-p3` (priority), `.chip-blocked`, `.chip-late`, `.chip-on` | color communicates state, not a generic badge variant system |
| Toast | `.toast`, `.toast.on` | fixed bottom-center, single active toast pattern (no stacking classes) |
| Empty state | `.empty-state` | dashed border box, heading + short copy + optional action |
| Loading / skeleton | `.sk`, `.skrow` | shimmer gradient animation, not spinners, for list/row placeholders |
| Error banner | `.banner` | persistent (not a toast) — CSS comment: must survive long enough to read and carry a retry action |
| Form layout | `.form`, `.formgrid` (2-col: form + sticky side panel), `.form-section`, `.form-row`, `.form-cols`, `.field-hint.invalid` | `.formgrid` collapses to 1 column at `max-width:1160px` |
| Confirmation dialog (component) | `ConfirmDialog` (`shared/components/confirm-dialog.jsx`) | props: `open, title, message, confirmLabel, cancelLabel, danger, busy, onConfirm, onCancel` |

Domain-specific patterns worth knowing about before building something similar:

- **`.rail` / `.railboard`** — the ticket pipeline/stage progress bar ("the signature," per
  the CSS comment): one geometry reused at three scales (`.rail-xs`, `.rail-md`, interactive
  `.railboard` in the drawer). States are `done`, `now`, `blocked` (diagonal hatch), `locked`
  (diagonal hatch, distinct from blocked) — color/pattern encodes state, not extra shapes.
- **`.teams-metrics` / `.team-panel__stats`** — dashboard-style stat strips, computed
  client-side from data already on screen (CSS comment flags this as a `ponytail:` shortcut —
  move to server-side aggregation if team counts stop being small).
- **`.due`** — a thin progress bar showing elapsed-vs-estimated time, switches to `--alarm`
  when late.

## 6. Responsive behavior

Breakpoints in use (all `max-width`, mobile-first is NOT the approach — desktop is default,
rules narrow down): `1320px`, `1180px`, `1160px` (form grid collapse), `1080px`, `1023px`,
`860px`, `820px`, `767px`, `560px`, `540px`. No single canonical breakpoint set — each section
defines its own where its layout actually breaks.

Touch/mobile-specific rules: form inputs get `font-size:16px` + `min-height:44px` below `820px`
(prevents iOS zoom-on-focus and keeps tap targets ≥44px); `@media (hover:none)` strips
decorative hover states; `@media (prefers-reduced-motion:reduce)` collapses all animation/
transition durations to near-zero.

## 7. Accessibility patterns observed

- `:focus-visible{ outline:2px solid var(--sig); outline-offset:2px; }` set globally — every
  interactive element gets a consistent focus ring, not per-component overrides.
- Sortable table headers use `aria-sort`; selected rows use a plain class, not `aria-selected`.
- Tabs use `aria-selected="true"` on the active `.tab`.
- Segmented controls (`.seg button`) use `aria-pressed`.
- Disabled state is `[disabled]` + reduced opacity + `cursor:not-allowed` — consistent across
  buttons, menu items, file items.
- `prefers-reduced-motion` is respected globally (see above).
- Not verified from CSS alone: full keyboard-navigation coverage, screen-reader labeling
  completeness, color-contrast ratios. Mark as **Unknown / needs confirmation** — would need a
  live audit, not a stylesheet read, to confirm.

## 8. UX principles observed in the codebase (not written elsewhere, inferred from comments/structure)

- **Modals stay short.** The `.dlg` comment explicitly restricts dialogs to confirmations or
  one short field; anything longer becomes a full page (see `team-form.jsx` sharing one page
  shell between `/teams/new` and `/teams/[id]/edit` instead of a modal).
- **History must never look like history is missing.** The `.railseg.locked` CSS comment: a
  passed pipeline stage must always render as passed, never as "forbidden" — locked and
  blocked use visually distinct treatments so past state is never misread.
  Locked (crosshatch on the same rule tone) vs. done (`--sig-line` fill).
- **Errors are banners, toasts are transient acknowledgements.** Deliberate split: `.banner`
  persists with a retry; `.toast` self-dismisses.
- **Truncation must not eat status.** The `td.t-title .titleflex` comment: flag chips are
  placed before the truncating title text so a "Blocked" chip is never the part that gets
  clipped.
- **Progressive disclosure via sticky context, not extra pages.** `.formgrid`'s side panel
  (`.formside`) and the team form's `.team-context` panel keep supporting info visible next to
  the primary task instead of behind a tab or a second screen.
