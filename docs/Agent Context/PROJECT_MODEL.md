# Project Model

How PROWPLUS's business entities fit together — what's actually implemented today versus
the general-purpose model the product is moving toward. See
[`DATA_MODEL.md`](./DATA_MODEL.md) for full field-level schemas and
[`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md) for the "why" behind the target shape.

## Current model (implemented)

```
Project
  ├── Teams (Team.project → Project)
  │     └── Members (Team.members: [User])
  └── Tickets (Ticket.project → Project)
        ├── reporter, assignee, watchers (→ User)
        ├── team (→ Team, optional)
        └── embedded: comments, attachments, activityLog, stageHistory, reactions, links
```

- **Project** is the top-level container. It carries `brand` (a free-text label — the
  closest thing to a "client" today, not a real entity) and `modules` (a ticket-taxonomy
  tag list, not an access boundary).
- **Team** belongs to exactly one Project (`Team.project`), has a lead and a member list,
  both drawn from `User`.
- **Ticket** belongs to exactly one Project, optionally to one Team, and tracks its own
  lifecycle via `stage` + `stageHistory`, validated through `shared/stages.js`'s
  `canTransition()` (imported by both frontend and backend so the two can't disagree on
  legal transitions).
- **User** is global — not scoped to a Project or Team by membership records beyond
  `Team.members`/`Team.lead` and Ticket's reporter/assignee/watcher fields. Authorization
  is a single flat `role` enum on the user (see [`RBAC.md`](./RBAC.md)), not a per-project
  or per-team grant.
- There is exactly one work-item type, **Ticket** — no separate `Task` entity.
- **Notification** and **EmailLog** are cross-cutting, not nested under Project.

So today's hierarchy is `Project → Team → Ticket`, with `User` cutting across all three,
and no `Organization`, `Client`, or `Environment`-as-access-scope layer above `Project`.

## Target model (recommended, not yet implemented)

```
Organization
  → Client
    → Project
      → Team              (org-wide teams also possible — see below)
        → Member
      → Task / Ticket
      → Workflow
      → Environment        (dev / staging / production — an access scope, not a data field)
```

Key distinctions the current model doesn't yet make:

- **Client vs. Project**: a Client should be a first-class entity that can own multiple
  Projects. Today `Project.brand` is a display string with no relations, uniqueness, or
  own record — two projects for the same real-world client aren't linkable.
- **Global vs. project-scoped teams**: the target model allows a Team to be either
  organization-wide (works across many Projects) or scoped to one Project. Today every
  Team has exactly one `project` — there's no org-wide team.
- **Project membership vs. Team membership**: the target model separates "who can see/act
  on this Project at all" (project membership + project role) from "who's on this Team".
  Today there's no Project-level membership record — access is entirely role-based and
  global, not project-scoped, so anyone with sufficient `role` can act on any Project.
- **Environment as an access scope**: `Ticket.environment` exists today, but only as a
  2-value descriptive field ("where did this bug happen"), not as something a user can be
  explicitly granted or denied access to. The target model's environment scoping — e.g. a
  developer having Development + Staging but not Production — has no implementation to
  build on yet; see [`RBAC.md`](./RBAC.md) for the gap.
- **Task vs. Ticket**: the target model lists both; the current model has only Ticket
  filling both roles.
- **Workflow**: not a distinct configurable entity today — ticket lifecycle is a fixed
  stage enum + transition table in `shared/stages.js`, not a per-project customizable
  workflow.

## What this means for new work

- Don't hard-code the assumption that a Project has exactly one "client" string — if
  building toward Client-as-entity, introduce it as a real referenced document rather than
  extending the `brand` string further.
- Don't build project-scoped permissions on top of the flat `role` field without first
  deciding whether that becomes a `ProjectMember` join (role-per-project) or a separate
  `Permission`/scope system — see [`RBAC.md`](./RBAC.md)'s target model for the intended
  shape, so a stopgap doesn't get built that later conflicts with it.
- Keep `canTransition()` in `shared/` as the single source of truth for ticket lifecycle if
  a real per-project Workflow entity is introduced later — don't fork transition logic
  between frontend and backend.
