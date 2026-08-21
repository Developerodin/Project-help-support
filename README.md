# Dharwin PMS

A project/team/ticket management system (PMS). Originated as a Dharwin-specific tool and is
mid-transition to a general-purpose, multi-client PMS — see
[`docs/PRODUCT_PRINCIPLES.md`](./docs/PRODUCT_PRINCIPLES.md) and
[`docs/PROJECT_MODEL.md`](./docs/PROJECT_MODEL.md) for what that means and how far it's
gotten.

## What it does today

Projects contain Teams and Tickets. Users authenticate, get invited, and are assigned a
global role (`admin`, `lead`, `qa`, `developer`, `member`). Tickets carry comments,
attachments, a stage lifecycle with validated transitions, and drive in-app + email
notifications; ticket analytics are aggregated per project/team. See
[`docs/FEATURES.md`](./docs/FEATURES.md) for the full implemented/partial breakdown.

## Architecture at a glance

npm-workspaces monorepo: an Express 4 API (`backend/`, MongoDB via Mongoose) and a Next.js
15 App Router frontend (`frontend/`), sharing framework-free constants/enums/email
templates via `shared/` (`@pms/shared`). Auth is a short-lived JWT (in-memory on the
client) plus an httpOnly refresh cookie. Full details: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

```
backend/    Express API — module-per-vertical-slice (model/route/controller/service/validation)
frontend/   Next.js App Router — app/(auth) public, app/(app) authenticated
shared/     @pms/shared — enums, stages, notification events, email templates
scripts/    one-off maintenance scripts, not part of the running app
docs/       architecture, design, data model, API, RBAC, security, testing, deployment docs
```

## Documentation

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Technical architecture, stack, module boundaries, tech debt |
| [DESIGN.md](./docs/DESIGN.md) | UI/UX system — colors, typography, spacing, component patterns |
| [DATA_MODEL.md](./docs/DATA_MODEL.md) | Database entities, fields, relationships, ER diagram |
| [API.md](./docs/API.md) | REST endpoints, auth requirements, request/response shapes |
| [RBAC.md](./docs/RBAC.md) | Current role model + target scoped access-control model |
| [PROJECT_MODEL.md](./docs/PROJECT_MODEL.md) | How Project/Team/Ticket/User fit together, current vs. target |
| [FEATURES.md](./docs/FEATURES.md) | Feature inventory: implemented / partial / not present |
| [UI_COMPONENTS.md](./docs/UI_COMPONENTS.md) | Reusable frontend component catalog |
| [SECURITY.md](./docs/SECURITY.md) | Auth, session handling, validation, known security gaps |
| [TESTING.md](./docs/TESTING.md) | Test frameworks, coverage, known gaps |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Build/start commands, env vars, CI/CD status |
| [ADR.md](docs/Agent Context/ADR.md) | Recorded architectural decisions and their reasoning |
| [PRODUCT_PRINCIPLES.md](./docs/PRODUCT_PRINCIPLES.md) | What the product is meant to become |

## Local development

Requires Node ≥20 and a MongoDB instance.

```bash
npm install                 # installs all three workspaces (shared, backend, frontend)

cp backend/.env.example backend/.env    # fill in MONGODB_URL, JWT_SECRET, etc.
cp frontend/.env.example frontend/.env  # fill in NEXT_PUBLIC_API_URL

npm run dev:backend         # API on :4000 (or backend/.env's PORT)
npm run dev                 # frontend on :3002
```

Both `.env.example` files document every variable inline, including which groups are
all-or-nothing (S3 storage, SMTP email, admin seeding) — see
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for the full reference and current CI/CD status
(none is configured in this repo yet).

## Testing

```bash
npm test                    # runs backend (node --test) + frontend (vitest) + shared
npm run lint
```

Backend tests use `mongodb-memory-server` — no external database needed. See
[`docs/TESTING.md`](./docs/TESTING.md) for coverage by module and known gaps.

## Contributing

- New backend feature → new folder under `backend/src/modules/`, same five-file shape as
  existing modules (`model/route/controller/service/validation`). Register the router in
  `backend/src/app.js`.
- New frontend page → route under `frontend/app/(app)/` or `app/(auth)/`; pull logic/markup
  into `frontend/shared/components/` once it's more than a thin data shell.
- A constant, enum, or status value used by both apps belongs in `shared/`, imported via
  `@pms/shared`.
- Check [`docs/UI_COMPONENTS.md`](./docs/UI_COMPONENTS.md) and
  [`docs/DESIGN.md`](./docs/DESIGN.md) before adding new UI — reuse an existing component or
  token before introducing one.
- Read [`docs/PRODUCT_PRINCIPLES.md`](./docs/PRODUCT_PRINCIPLES.md) before modeling a new
  entity or access rule — the target shape (Organization → Client → Project → Team →
  Ticket, scoped access) is documented so incremental work moves toward it instead of away
  from it.
