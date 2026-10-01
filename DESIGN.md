---
name: Project Management
description: A desk ledger for tickets, teams, and access. Warm paper, one signal blue, a pipeline rail.
colors:
  paper: "oklch(0.988 0.003 85)"
  panel: "oklch(0.963 0.004 85)"
  panel-2: "oklch(0.938 0.005 85)"
  rule: "oklch(0.892 0.006 85)"
  rule-soft: "oklch(0.930 0.005 85)"
  ink: "oklch(0.245 0.014 262)"
  ink-2: "oklch(0.480 0.011 262)"
  ink-3: "oklch(0.515 0.012 262)"
  signal: "oklch(0.455 0.135 262)"
  signal-hi: "oklch(0.395 0.145 262)"
  signal-ink: "oklch(0.988 0.003 85)"
  signal-wash: "oklch(0.455 0.135 262 / 0.09)"
  signal-line: "oklch(0.455 0.135 262 / 0.35)"
  alarm: "oklch(0.530 0.185 27)"
  alarm-wash: "oklch(0.530 0.185 27 / 0.10)"
  warn: "oklch(0.58 0.13 68)"
  warn-hi: "oklch(0.46 0.14 62)"
  warn-wash: "oklch(0.58 0.13 68 / 0.12)"
  ok: "oklch(0.50 0.06 155)"
  ok-hi: "oklch(0.42 0.07 155)"
  ok-wash: "oklch(0.50 0.06 155 / 0.10)"
  paper-dark: "oklch(0.196 0.010 262)"
  panel-dark: "oklch(0.243 0.012 262)"
  panel-2-dark: "oklch(0.284 0.013 262)"
  rule-dark: "oklch(0.330 0.014 262)"
  ink-dark: "oklch(0.945 0.004 85)"
  ink-2-dark: "oklch(0.760 0.008 262)"
  ink-3-dark: "oklch(0.610 0.010 262)"
  signal-dark: "oklch(0.705 0.125 262)"
  signal-hi-dark: "oklch(0.780 0.115 262)"
  signal-ink-dark: "oklch(0.180 0.012 262)"
  alarm-dark: "oklch(0.685 0.160 27)"
  warn-dark: "oklch(0.78 0.11 72)"
  ok-dark: "oklch(0.72 0.08 155)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.022em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.022em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.011em"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.055em"
  mono:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, JetBrains Mono, Roboto Mono, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
rounded:
  sm: "4px"
  md: "6px"
  chip: "3px"
spacing:
  control: "30px"
  control-touch: "44px"
  bar: "48px"
  page-x: "22px"
  page-y: "20px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: "0 11px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hi}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: "0 11px"
  button-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: "0 11px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
    padding: "0 9px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    height: "18px"
    padding: "0 6px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 11px 9px"
---

# Design System: Project Management

## 1. Overview

**Creative North Star: "The Desk Ledger"**

This is the interface of a delivery desk, not a campaign page. A lead scans ticket stage, ownership, and access on a laptop in ordinary daylight. The same desk stays usable after hours, so dark mode is the night shift of the same tokens, not a second product. Density is high because the work is a list, a board, and a drawer. Personality comes from the pipeline rail and from mono ticket ids, not from decoration.

The system rejects the generic tool look: big metric heroes, identical icon cards, gradient headlines, glass panels, and a second accent "to add energy." Light paper is the ground. Signal blue is scarce. Rules are hairlines. Shadows appear only when a surface lifts off the desk (drawer, popover, toast).

**Key Characteristics:**

- Warm paper surfaces, ink text, one blue signal
- Pipeline rail as the signature: filled segments, gaps between lanes, no extra hues
- System sans at 13.5px; mono only for ids, counts, and keys
- 4px control corners, 6px cards and drawers
- Flat at rest; `--shadow-pop` and `--shadow-drawer` only when a layer actually floats
- Touch density starts at 820px: control height becomes 44px, inputs become 16px

## 2. Colors

A restrained desk palette. Paper carries the page. Signal blue carries the current stage, the primary action, and links. Alarm, warn, and ok are status, never decoration.

### Primary

- **Signal Blue** (`oklch(0.455 0.135 262)`): Primary buttons, links, the current rail segment, selected rows, focus rings. Hover deepens to **Signal Pressed** (`oklch(0.395 0.145 262)`). Text on the button is **Signal Ink** (`oklch(0.988 0.003 85)`).
- **Signal Wash** (`oklch(0.455 0.135 262 / 0.09)`) and **Signal Line** (`oklch(0.455 0.135 262 / 0.35)`): Selected rows, completed rail segments, focus halos. Wash is a tint, never a fill for large regions.

### Neutral

- **Warm Paper** (`oklch(0.988 0.003 85)`): Page and card ground. Hue 85, chroma almost nothing.
- **Desk Panel** (`oklch(0.963 0.004 85)`): Top bar fields, toolbars, table headers, default buttons.
- **Panel Shade** (`oklch(0.938 0.005 85)`): Hover on panels, secondary fills.
- **Hairline** (`oklch(0.892 0.006 85)`) and **Soft Rule** (`oklch(0.930 0.005 85)`): Borders and row dividers.
- **Ledger Ink** (`oklch(0.245 0.014 262)`): Body text. Contrast on paper is about 15.7:1.
- **Ink Secondary** (`oklch(0.480 0.011 262)`): Supporting copy. About 6.3:1 on paper.
- **Ink Quiet** (`oklch(0.515 0.012 262)`): Uppercase labels, placeholders, empty lane copy. About 5.4:1 on paper and about 4.7:1 on Panel Shade, so it clears 4.5:1 on both.

### Semantic

- **Alarm** (`oklch(0.530 0.185 27)`) with **Alarm Wash** (`oklch(0.530 0.185 27 / 0.10)`): Blocked, destructive, error. Pair the wash with ink text. Do not set white text on Alarm; that pair fails contrast.
- **Amber** (`oklch(0.58 0.13 68)`): Warning fills and lines. Text uses **Amber Ink** (`oklch(0.46 0.14 62)`), which clears 7:1 on paper. Amber itself as text on paper is about 4.3:1 and fails AA.
- **Quiet Green** (`oklch(0.50 0.06 155)`) and **Green Ink** (`oklch(0.42 0.07 155)`): Done, valid drop, low priority. The chroma stays low so green never competes with Signal Blue.

### Night

Dark mode redefines the same roles. **Night Paper** (`oklch(0.196 0.010 262)`), **Night Panel** (`oklch(0.243 0.012 262)`), **Night Ink** (`oklch(0.945 0.004 85)`), **Night Signal** (`oklch(0.705 0.125 262)`). Do not invent night-only hues.

**The One Signal Rule.** Signal blue marks the current stage, the primary button, links, and the keyboard focus ring. It is not a background for sections, not a sidebar wash, and not a gradient.

**The Voice Exception.** The assistant's voice orb is the one place the product is expressive. Its palette follows who has the floor: slate while starting, coral and amber while the user speaks, violet while it thinks, the signal blue family while it speaks. The colours blend between phases and, full screen, tint the room faintly. They live only on `.voice-dock` (`--orb-a`, `--orb-b`, `--orb-c`) and must not spread to other components.

**The Paper Ground Rule.** Light is the default scene. Dark mode is the same ledger after hours: every color is a redefinition of an existing token. A hardcoded hex that ignores `data-theme` is a defect.

## 3. Typography

**Display Font:** The system sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif`)
**Body Font:** The same stack
**Label/Mono Font:** `ui-monospace, "Cascadia Mono", "SF Mono", "JetBrains Mono", "Roboto Mono", Menlo, Consolas, monospace`

**Character:** One utilitarian sans, slightly tight tracking, so the desk feels native on Windows and macOS. Mono is a stamp for ids, not a display voice.

### Hierarchy

- **Display** (700, `1.5rem`, tracking `-0.022em`): Page titles (`h1`). Fixed rem, not fluid.
- **Headline** (600, `1.125rem`): Drawer titles and `h2`.
- **Title** (600, `0.9375rem`): Section titles and `h3`.
- **Body** (400, `13.5px`, line-height `1.45`, tracking `-0.011em`): UI copy. Prose on legal pages may run larger, capped near 65–75ch. At the 820px touch breakpoint body becomes 14px, and focused inputs become 16px so iOS does not zoom.
- **Label** (600, `0.6875rem`, tracking `0.055em`, uppercase): Field names (`.lbl`) and table headers. Color is Ink Quiet. This size does not qualify as large text, so it still needs 4.5:1.
- **Mono** (600, `0.75rem`, tracking `-0.02em`): Ticket ids, counts, keyboard hints.

**The One Family Rule.** Headings, buttons, labels, and body share the system sans. Mono is for identifiers and numbers. A display serif or a second sans is prohibited in the product UI.

## 4. Elevation

The desk is flat. Depth is a change of paper tone (paper, panel, panel-2) plus a 1px hairline. Shadows exist only when a surface leaves the page.

### Shadow Vocabulary

- **Drawer** (`box-shadow: 0 0 0 1px oklch(0.245 0.014 262 / 0.08), -18px 0 48px -12px oklch(0.245 0.014 262 / 0.18)`): Ticket drawer and other right-edge sheets. Night uses a black pair at 0.5 and 0.6 alpha.
- **Popover** (`box-shadow: 0 0 0 1px oklch(0.245 0.014 262 / 0.09), 0 10px 28px -10px oklch(0.245 0.014 262 / 0.30)`): Menus, dialogs, toasts. There is no `--shadow` token. Popovers use `--shadow-pop`.

**The Flat Desk Rule.** Resting surfaces have no drop shadow. If a shadow shows on a card, a list row, or a form section, it is wrong. Motion that lifts a control (translate, scale, elastic) is also wrong; state changes use color and border in 120 to 180ms ease-out.

## 5. Components

Controls share one height token, `--ctl-h` (30px at the desk, 44px at 820px and below). Corners are 4px. Primary is filled Signal Blue. Everything else is a panel with a hairline.

### Buttons

- **Shape:** Tight corners (`4px`, `--r`). Height 30px (`.btn`). Small is 26px (`.btn-sm`). Icon is 30px square, 26px when small.
- **Primary:** Signal Blue fill, Signal Ink text, padding `0 11px`. Hover is Signal Pressed. Disabled is 0.42 opacity, not a new color.
- **Hover / Focus:** Hover shifts panel buttons to Panel Shade and darkens the hairline. Focus is the global ring: `2px solid` Signal Blue, `2px` offset.
- **Secondary / Ghost:** Default button is Desk Panel plus Hairline. Ghost has no border until hover. Danger is Alarm fill with near-white text only when contrast holds; prefer Alarm Wash plus Ink when it does not.
- **Touch:** Below 820px, default buttons become 36px. Drawer footer buttons and the top bar become 44px. New work should use 44px for every phone action, including `.btn-sm` and icon buttons.

### Chips

- **Style:** 18px tall, `3px` radius, Hairline border, Ink Secondary on Desk Panel. Priority chips (P1–P4) use Alarm, Amber Ink, Signal Pressed, and Green Ink, each on a tinted panel.
- **State:** `.chip-on` is Signal text on Signal Wash. Blocked is dashed Alarm. Late is Amber Ink on Amber Wash.

### Cards / Containers

- **Corner Style:** `6px` (`--r-lg`).
- **Background:** Warm Paper. Hover moves to Desk Panel and darkens the hairline. No shadow.
- **Shadow Strategy:** None at rest. See The Flat Desk Rule.
- **Border:** 1px Hairline.
- **Internal Padding:** `10px 11px 9px`.
- **Board:** Lanes scroll sideways above 820px (`min-width: 198px` each) and stack below it. The ticket table is the exception that becomes a stacked list at 820px. Other tables still force `min-width: 940px` and should not; that is a defect, not a pattern to copy.

### Inputs / Fields

- **Style:** Height `--ctl-h`, Hairline border, Desk Panel fill, 4px corners, padding `0 9px`.
- **Focus:** Border becomes Signal Blue and a 3px Signal Wash ring. Do not leave `outline: none` without that ring.
- **Error / Disabled:** Error border is Alarm. Disabled buttons fade to 0.42. Placeholder text is Ink Quiet on Desk Panel (about 4.55:1): do not lighten it further.
- **Phone:** At 820px, form fields get `min-height: 44px` and `font-size: 16px`.

### Navigation

- **Desktop:** Shadcn sidebar, width `14rem`, collapsed to `3.5rem`. It becomes a sheet below 768px. The app's touch rules start at 820px, so 768–820 is a squeezed hybrid; new layout should use one breakpoint.
- **Top bar:** Sticky, 48px, hairline along the bottom. Search, project switcher, new-ticket, bell, theme, profile. Search shrinks with container queries before the bar wraps. At 820px the bar wraps, hides button labels, and grows controls to 44px.
- **Active:** Sidebar accent is Panel Shade. Current ticket stage is Signal Blue on the rail, not a second nav color.

### Pipeline rail

The signature. One geometry at three scales (`.rail-xs` 78×6, `.rail-md` full width × 8, drawer stage line). Passed segments are Signal Line. The current segment is Signal Blue. Blocked is an Alarm stripe pattern. Lanes are separated by a 1px gap, never by a new color. Stage names truncate; they do not wrap into a second rainbow.

## 6. Do's and Don'ts

There is no PRODUCT.md in this repo yet. These guardrails are the ones the stylesheet already states, plus the failures a new screen must not repeat.

### Do:

- **Do** theme through the tokens in `frontend/app/design-system.css` (`--paper`, `--ink`, `--sig`, `--alarm`, `--warn`, `--ok`, and their washes). Dark mode only redefines those variables.
- **Do** keep Signal Blue on the current stage, the primary button, links, and the focus ring.
- **Do** use the pipeline rail (filled segments, 1px gaps) when showing stage. Do not replace it with a row of colored dots.
- **Do** use `--ctl-h` for side-by-side controls, 44px at the 820px breakpoint, and 16px input text there so mobile Safari does not zoom.
- **Do** use `--shadow-pop` or `--shadow-drawer` when a layer floats. Resting cards stay flat.
- **Do** give data tables a stacked or wrapping layout under 820px. The ticket list already does this. People, notification settings, analytics, and RBAC tables must follow.

### Don't:

- **Don't** add a second brand accent, a purple gradient, or a neon dark theme. Night is the same ledger.
- **Don't** use `border-left` or `border-right` thicker than 1px as a colored status stripe on toasts, QA items, list rows, or callouts.
- **Don't** use gradient text (`background-clip: text`) for titles, metrics, or loading labels.
- **Don't** use glass blur, hero metric blocks, or identical icon-card grids.
- **Don't** introduce another button shape beside `.btn`. The shadcn `Button` must match `.btn` (30px, 4px radius, Signal Blue) or it should not ship on product screens.
- **Don't** hardcode hex, `#000`, or `#fff` in components. UI QA status chips that use `#fff4e5` / `#e8f1ff` / `#e8f7ee` break dark mode.
- **Don't** reference `var(--shadow)`. That token does not exist.
- **Don't** use bounce or elastic easing, and don't lift or squash a button on hover or press.
- **Don't** put Amber (`--warn`) on Warm Paper as text. It fails 4.5:1.
