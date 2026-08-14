# Dharwin PMS — Email Layout System

## Purpose

Single source of truth for **all transactional and notification emails** sent by Dharwin PMS. Every outbound message uses `@pms/shared/email` render functions that return `{ subject, text, html }` — no inline HTML in backend routes, no plain-text-only paths.

## Architecture

```
shared/email/          ← templates + layout (consumed by backend & frontend preview)
  brand.js             ← design tokens
  layout.js            ← table-based HTML shell + helpers
  invite.js            ← workspace invite
  password-reset.js    ← password reset
  ticket.js            ← all NOTIFICATION_EVENTS ticket emails
  index.js             ← exports + listEmailPreviews()

backend/src/platform/email/templates/index.js   ← re-exports @pms/shared/email
backend/src/modules/notifications/dispatch.js   ← invite, reset, ticket fan-out
backend/src/modules/notifications/email.service.js ← ticket SMTP outbox
frontend/app/(app)/dev/emails/page.jsx            ← live preview
```

**HTML strategy:** table-based layout, inline CSS only, max width 600px. No external stylesheets or images (brand mark is CSS spans). All user-supplied strings pass through `escapeHtml`.

**Plain text:** every render function must return a readable `text` body — required for clients that strip HTML and for SMTP fallbacks.

## File map

| File | Role |
|------|------|
| `brand.js` | `EMAIL_BRAND` — colors, fonts, product names |
| `escape.js` | `escapeHtml()` for user content |
| `layout.js` | `renderEmailLayout()` shell + `eyebrow`, `paragraph`, `detailTable`, `quoteBlock`, `mutedNote`, `linkFallback` |
| `invite.js` | `renderInviteEmail({ link, recipientName })` |
| `password-reset.js` | `renderPasswordResetEmail({ link, recipientName })` |
| `ticket.js` | `renderTicketEmail(event, ticket, context, config)` + `ticketEmailSubject()` |
| `index.js` | Public exports + `listEmailPreviews()` for dev preview |

## Brand tokens

Import from `shared/email/brand.js` — **do not duplicate hex values** in templates.

| Token | Use |
|-------|-----|
| `EMAIL_BRAND.shortName` / `fullName` | Headings, footer |
| `colors.canvas` | Outer background |
| `colors.paper` | Card background |
| `colors.panel` | Quote blocks |
| `colors.ink` / `inkSecondary` / `inkMuted` | Text hierarchy |
| `colors.sig` / `sigInk` | CTA button |
| `colors.rule` / `ruleSoft` | Borders, table rules |
| `colors.railDone` / `railNow` / `railTodo` | Pipeline rail segments |
| `colors.alarm` | Urgent priority / blocker |
| `fontFamily` / `monoFamily` | Body and ticket-id text |

Palette aligns with `frontend/app/design-system.css` light theme.

## Layout API

### `renderEmailLayout({ preheader, eyebrow, title, bodyHtml, cta, footerNote })`

Returns a complete `<!DOCTYPE html>` document.

| Param | Description |
|-------|-------------|
| `preheader` | Hidden inbox snippet (Gmail-safe spacer included) |
| `eyebrow` | HTML from `eyebrow()` — uppercase kicker above title |
| `title` | `<h1>` headline (escaped) |
| `bodyHtml` | Inner card content (build from helpers below) |
| `cta` | `{ label, href }` — bulletproof primary button (`bgcolor` + `color:#ffffff !important` on anchor); omit for no CTA |
| `footerNote` | Optional line above the standard automated-message footer |

### Helpers (from `layout.js`)

| Helper | Use |
|--------|-----|
| `eyebrow(label, badge?)` | Event kicker; optional mono badge (e.g. ticket id) |
| `paragraph(text)` | Body copy |
| `detailTable([[label, value, opts?], ...])` | Key/value facts; empty values dropped; `opts: { mono, strong, tone: 'alarm' }` |
| `quoteBlock(label, text)` | Notes, reasons, comments — preserves line breaks |
| `mutedNote(text)` | Secondary guidance |
| `linkFallback(href)` | Paste-this-URL fallback below CTA |

### Pipeline rail (ticket emails only)

`pipelineRail(statusKey)` in `ticket.js` renders a 10-segment stage bar from `shared/stages.js`. Always pair with `context.to` (or `ticket.status`) so the current stage highlights correctly.

## How to add a new email type

1. **Render function** — add `renderMyEmail(params)` in a new file (or extend an existing one). Return `{ subject, text, html }`. Use `renderEmailLayout` + helpers; escape all dynamic input.
2. **Export** — add to `shared/email/index.js`.
3. **Preview** — append to `listEmailPreviews()` with realistic sample data.
4. **Backend wire-up** — call the render function in `dispatch.js` (transactional) or `email.service.js` (ticket notifications). Pass both `text` and `html` to `transport.sendMail`.
5. **Test** — add assertions in `shared/__tests__/email-templates.test.js` (subject, html markers, no support copy).
6. **Verify** — open `/dev/emails` in the frontend dev server and spot-check the new card.

Target: **under 30 minutes** following this checklist.

## Rules

- **No support / contact links** — no `mailto:`, no "Contact support", no help-desk URLs.
- **Inline CSS only** — no `<link>` stylesheets; `@media` in `<style>` is OK for mobile tweaks.
- **Escape all user content** — titles, names, comments, notes via `escapeHtml`.
- **Plain-text fallback required** — every send path must include `text`.
- **Max 600px** — card width in `renderEmailLayout`.
- **No remote images** — brand mark is inline CSS.
- **Footer copy is fixed** — "Automated message from Dharwin Project Management Portal. Replies to this address are not monitored."

## Ticket notification events

All keys in `shared/notification-events.js` (`NOTIFICATION_EVENTS`). Rendered by `renderTicketEmail` in `ticket.js`. Context built in `backend/src/modules/notifications/dispatch.js` → `buildEmailContext()`.

| Event | Subject pattern | Context fields |
|-------|-----------------|----------------|
| `TICKET_CREATED` | `[ID] Filed: title` | `actorName`, `to` (defaults to `ticket.status`) |
| `TICKET_ASSIGNED` | `[ID] Assigned: title` | `actorName`, `to` |
| `TICKET_STAGE_CHANGED` | `[ID] {stage label}: title` | `actorName`, `from`, `to`, `note?` |
| `TICKET_REOPENED` | `[ID] Reopened: title` | `actorName`, `from`, `to`, `note?` |
| `TICKET_CLOSED` | `[ID] Closed: title` | `actorName`, `from`, `to`, `reason?` |
| `TICKET_COMMENTED` | `[ID] New comment: title` | `actorName`, `to`, `comment`, `commentAuthor` (from `event.commentId` + ticket) |
| `TICKET_MENTIONED` | `[ID] You were mentioned: title` | Same as commented + `mentions[]` for recipient resolution |
| `TICKET_ESTIMATE_SET` | `[ID] Estimates updated: title` | `actorName`, `to` |

**Ticket document fields** used in the detail table: `ticketId`, `title`, `description` (created only), `status`, `module`, `page`, `category`, `priority`, `severity`, `environment`, `labels`, `assignedTo.name`, `createdBy.name`, `estimatedResolutionAt`, `expectedReleaseDate`, `reopenCount`, `blocked`, `blockerReason`.

**Config:** `{ frontendBaseUrl }` — builds CTA link to `/tickets?ticket={ticketId}`.

## Send paths (wiring reference)

| Trigger | Backend entry | Render function |
|---------|---------------|-----------------|
| Admin creates user | `user.controller.create` → `buildInviteDeliverer` | `renderInviteEmail` |
| Admin resend invite | `user.controller.resendInvite` → `buildInviteDeliverer` | `renderInviteEmail` |
| Forgot password | `auth.controller.forgotPassword` → `buildResetDeliverer` | `renderPasswordResetEmail` |
| Ticket create / assign / transition / comment | `ticket.controller` → `dispatchTicketEvent` → `sendTicketEmail` | `renderTicketEmail` |

## Testing

```bash
# Shared template unit tests
npm test -w @pms/shared

# Backend notification + outbox tests
npm test -w @pms/backend
```

Shared tests cover escape, each template shape, `listEmailPreviews()` count (10 types), and absence of support copy.

**Preview:** run the frontend dev server and visit **`/dev/emails`**. Cards are built from `listEmailPreviews()` — no SMTP required.
