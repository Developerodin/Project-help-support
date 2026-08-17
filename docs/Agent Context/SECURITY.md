# Security

Current implementation, with gaps called out explicitly rather than glossed
over. See `RBAC.md` for the authorization model this builds on.

## Authentication

- Email + password login (`backend/src/modules/auth/auth.service.js:39`).
  Passwords hashed with **bcrypt, 10 rounds** (`user.model.js:8,90`).
- Login failure is a single generic error (`INVALID_CREDENTIALS`) for both
  "no such user" and "wrong password", and a **dummy bcrypt compare runs on
  the no-such-user path** specifically to equalize response timing and avoid
  turning login into an account-existence oracle (`auth.service.js:43-47`).
- `forgot-password` returns the identical response whether or not the email
  exists, for the same reason (`auth.controller.js:59-68`).
- Access tokens: JWT, `HS256` via `jsonwebtoken`, signed with `JWT_SECRET`,
  15 min default expiry (`config.js:92-93`, `token.service.js:11-17`),
  carried as `Authorization: Bearer`.
- **Refresh tokens are opaque, not JWTs**: 48 random bytes, stored server-side
  only as a SHA-256 hash (`token.service.js:7-9,24-33`), 30-day default expiry,
  delivered as an `httpOnly`, `Secure` (in production), `SameSite=Strict`
  cookie scoped to `/v1/auth` (`auth.controller.js:7-16`).
- **Refresh rotation with reuse detection**: each refresh consumes the
  presented token and issues a new one; a token presented a second time is
  treated as a replay/theft and **revokes every session for that user**, not
  just the one request (`token.service.js:53-97`).
- A password reset also revokes all existing refresh tokens for that user
  (`auth.service.js:177-178`) — a changed password ends every session.
- Every request re-verifies the user's `status === 'active'` and re-reads
  `role` from the database rather than trusting the JWT payload, so a
  deactivated or role-changed user is rejected on their *next* request, not
  when their access token happens to expire (`platform/auth.js:7-14`).
- Invite and password-reset tokens follow the same pattern as refresh tokens:
  random raw value, only the SHA-256 hash persisted, single-use (the hash is
  cleared on success), time-limited (72h invite / 2h reset)
  (`auth.service.js:91-137,143-179`).

## CSRF / cross-origin

- `sameOrigin` middleware (`backend/src/platform/sameOrigin.js`) is a second
  line of defense behind `SameSite=Strict` on the refresh cookie: it checks
  `Origin` (falling back to `Referer`) against the configured CORS allowlist
  for every non-GET/HEAD/OPTIONS request to `/refresh` and `/logout`. A
  request with neither header is allowed through (treated as curl/server-to-
  server, which can't carry a victim's ambient cookies).
- CORS itself (`app.js`): explicit origin allowlist from `CORS_ORIGINS`,
  `credentials: true`.

## Transport / headers

- `helmet()` for standard security headers, `compression()`, request body
  capped at `1mb` for JSON (`app.js`).
- `express-mongo-sanitize()` strips Mongo operator injection (`$gt`, `$where`,
  etc.) from `req.body`/`req.query`/`req.params` (`app.js`).
- Every response carries an `X-Request-Id` (generated or echoed back,
  capped at 200 chars) for correlating logs — set before auth/validation/
  routing so even a 401/404 gets one (`platform/requestId.js`).

## Secrets / environment variables

`backend/src/platform/config.js` is the single source of truth for what env
vars the backend reads (names only, values never logged):

- **Required to boot**: `MONGODB_URL`, `JWT_SECRET`, `FRONTEND_BASE_URL`,
  `CORS_ORIGINS`.
- **Capability groups** (all-or-nothing — partially set is a boot-time config
  error, not a silent partial feature): storage (`AWS_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`), email
  (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM`),
  seed admin (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`).
- **Production hardening at boot** (`config.js:49-65`): refuses to start in
  production if `JWT_SECRET` is a known placeholder (`changeme`, `secret`,
  etc.) or shorter than 32 characters, or if `SEED_ADMIN_PASSWORD` is a known
  placeholder.
- `.env` is loaded once, from `backend/.env` specifically (not a shared root
  `.env`) — `loadEnv.js` notes this was a deliberate fix after a shared file
  leaked backend `PORT`/`NODE_ENV` into the Next.js build.

## Input validation

Every route validates its request with a `Joi` schema (`platform/validate.js`
+ one `*.validation.js` per module) before the controller runs.

## File uploads

`backend/src/platform/upload.js` — allowlist, not a blocklist:

- Extension **and** magic-byte content sniffing must agree
  (`MIME_EXTENSION_MISMATCH` if not) — the client-declared `Content-Type` is
  never trusted.
- Hard-blocked extensions regardless of content: `exe, dll, sh, bat, cmd, ps1,
  jar, msi, com, scr, app, deb, rpm, svg, html, htm, js, mjs, php` (`.svg` is
  blocked specifically because it's scriptable).
- 25MB per file, 10 files per request, 100MB request cap — enforced in the
  app **and** intended to be mirrored in the S3 bucket policy (comment notes a
  limit that exists in only one place is a limit that gets bypassed).
- Stored via `multer.memoryStorage()` — nothing untrusted touches server disk.
- Uploaded object keys are generated server-side
  (`safeKey` — `${prefix}/${userId}/${timestamp}-${random}.${ext}`); the
  original filename is kept only as display metadata and never used to build
  a path, so it can't path-traverse (`../`) or inject control characters.
- Office formats (`doc/xls/ppt/docx/...`) are only checked by container magic
  bytes (OLE/ZIP), not scanned for macros — documented as untrusted content
  pending a dedicated AV pipeline (see Gaps).

## Rate limiting

`express-rate-limit`, in-process store (`platform/rateLimit.js`):

| Limiter | Window | Limit | Keyed by |
|---|---|---|---|
| login | 15 min | 10 | email (falls back to IP) |
| password reset request | 60 min | 5 | email |
| invite accept | 60 min | 10 | IP |
| refresh | 15 min | 60 | IP |
| resend invite | 60 min | 10 | IP |

Explicitly documented as a `ponytail:` shortcut in-code: the in-memory store
is per-process, so it under-limits behind a multi-instance deployment. Called
out as the upgrade path once a second instance actually exists (shared store,
e.g. Redis).

## Logging

`morgan` HTTP access logs (method, url, status, response time, request id),
disabled in the `test` environment. `winston` for application logging
(`platform/logger.js`).

## Gaps (explicit, not implemented)

1. **No audit log.** Role changes, admin actions (user create/deactivate,
   project/team edits), and access grants are not recorded anywhere queryable.
   Anyone with the `admin` role today has silent, untracked reach.
2. **No scoped access control.** Authorization is a single global role per
   user (see `RBAC.md`) — there's no project-, client-, or environment-level
   boundary. In particular there's no "production access" concept at all, so
   the target-model principle "prod access must be explicit, never inherited"
   has nothing to attach to yet.
3. **Rate limiting doesn't survive horizontal scaling** — see above; a second
   backend instance effectively doubles every limit.
4. **No malware/macro scanning on uploaded documents** — magic-byte sniffing
   confirms file *type*, not file *safety*; Office documents with macros are
   accepted as long as the container format matches.
5. **No 2FA / MFA** on login.
6. **No account lockout** beyond the login rate limiter (10 attempts / 15 min
   per email) — no escalating backoff or manual unlock flow.
7. **No CSP (`Content-Security-Policy`) configuration** beyond Helmet's
   defaults was found — worth confirming Helmet's default CSP (if enabled) is
   appropriate for the actual frontend origins in use, or set explicitly.
