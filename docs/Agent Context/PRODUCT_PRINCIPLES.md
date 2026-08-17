# Product Principles

What PROWPLUS is supposed to become, independent of how it's implemented today. This exists
so that documentation and future changes don't quietly pull the product back toward being a
Dharwin-specific ticket tracker. See [`PROJECT_MODEL.md`](./PROJECT_MODEL.md) for how these
principles map to entities, and [`RBAC.md`](./RBAC.md) for the access-control target model.

## 1. General-purpose PMS

The system must not depend on Dharwin-specific terminology, products, teams, or workflows.
`shared/module-catalog.js`'s `WEB_MODULE_TAXONOMY` (ATS, courses, referral leads, etc.) is a
carried-over Dharwin page taxonomy, not this PMS's own domain model — confirm it's still
actually consumed before extending it, and don't model new PROWPLUS features after it.

## 2. Client-first

A client can have multiple projects. Not yet true in code — `Project.brand` is a free-text
label, not a linkable entity. See [`PROJECT_MODEL.md`](./PROJECT_MODEL.md).

## 3. Project-scoped work

Tasks, tickets, teams, workflows, and environments can be associated with a specific
project. Tickets and teams already are; environment-as-an-access-scope and
project-customizable workflow are not yet implemented.

## 4. Flexible teams

Teams can be organization-wide or project-specific. Today every `Team` belongs to exactly
one `Project` — there's no org-wide team yet.

## 5. Explicit access

Users should only receive access explicitly granted to them — not access implied by a
loosely-related role. Today, access is a single global `role` enum with no per-project
grant, which is the opposite of explicit, scoped access. This is the single biggest gap
between current and target state — see [`RBAC.md`](./RBAC.md).

## 6. Production is protected

Development and testing access must not automatically grant production access. There is no
environment-access concept to enforce this against yet (`Ticket.environment` is descriptive,
not an access boundary) — this principle should shape the design of that system when it's
built, not be retrofitted after.

## 7. Reusable UI

New screens should reuse existing components and design tokens rather than introducing
one-off styling. See [`UI_COMPONENTS.md`](./UI_COMPONENTS.md) for the current catalog and
[`DESIGN.md`](./DESIGN.md) for the token system — check both before adding new CSS or a new
component variant.

## 8. Progressive disclosure

Don't expose every advanced option by default. Prefer sane defaults with an explicit path
to more control, over a form or table that shows every possible field up front.

## 9. Auditability

Important administrative and access changes should be traceable. There is currently no
system-wide audit log — only a per-ticket `activityLog`. Treat this as a known gap (see
[`SECURITY.md`](./SECURITY.md)), not as evidence auditability isn't required.

## 10. Avoid hard-coded product assumptions

Don't hard-code Dharwin, ATS, AI Agents, Web Team, QA Team, or specific client names into
application logic, seed data conventions, or shared constants — unless they're actual
user-created data. `shared/module-catalog.js` is the one place in the current codebase that
violates this; it's flagged here rather than silently treated as a template to copy.
