# Documentation Plan

Saved reference: recommended `/docs` structure, the master Cursor prompt to generate it,
and a `PRODUCT_PRINCIPLES.md` draft for PROWPLUS's transition from a Dharwin-specific system
to a general-purpose client/project PMS. Not yet executed — see note at the end.

---

Yes. For your PMS, I would **not stop at `ARCHITECTURE.md` and `DESIGN.md`**. Since you're using Cursor to actively develop the system, a small set of living documentation files will make Cursor much more consistent and prevent it from randomly changing architecture/UI decisions.

I recommend this structure:

```text
/docs
├── ARCHITECTURE.md
├── DESIGN.md
├── DATA_MODEL.md
├── API.md
├── RBAC.md
├── PROJECT_MODEL.md
├── FEATURES.md
├── UI_COMPONENTS.md
├── SECURITY.md
├── TESTING.md
├── DEPLOYMENT.md
└── ADR.md

README.md
.env.example
```

### What each file is for

| File               | Purpose                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `ARCHITECTURE.md`  | Overall technical architecture, modules, data flow, backend/frontend structure |
| `DESIGN.md`        | Overall UI/UX principles, layouts, spacing, colors, typography, interactions   |
| `DATA_MODEL.md`    | Database entities and relationships                                            |
| `API.md`           | API conventions, endpoints, request/response patterns                          |
| `RBAC.md`          | Users, teams, roles, permissions, product/project/environment access           |
| `PROJECT_MODEL.md` | How clients → projects → teams → tickets → tasks fit together                  |
| `FEATURES.md`      | Product feature inventory and current/planned status                          |
| `UI_COMPONENTS.md` | Reusable UI components and when/how they should be used                        |
| `SECURITY.md`      | Authentication, authorization, production access, audit logs, sensitive data   |
| `TESTING.md`       | Unit/integration/E2E testing strategy                                          |
| `DEPLOYMENT.md`    | Environments, CI/CD, staging/production, environment variables                 |
| `ADR.md`           | Important architectural decisions and why they were made                       |
| `README.md`        | Developer onboarding and how to run the project                                |
| `.env.example`     | Required environment variables without secrets                                 |

For your project specifically, **`RBAC.md`, `PROJECT_MODEL.md`, and `UI_COMPONENTS.md` are especially important** because you're moving from a Dharwin-specific system toward a **general client/project-based PMS**.

---

# Master Cursor Prompt

Give Cursor this prompt **from the root of your existing repository**:

```text
You are working on an existing Project Management System (PMS) codebase.

Your task is to deeply inspect the entire repository and create a comprehensive, accurate documentation system for this project.

IMPORTANT:
- Do NOT modify application code.
- Do NOT refactor anything.
- Do NOT invent architecture, technologies, APIs, database models, features, or workflows that do not exist in the codebase.
- Documentation must reflect the CURRENT implementation first.
- Clearly distinguish between:
  1. Currently implemented
  2. Partially implemented
  3. Planned / recommended
- If something cannot be determined from the repository, explicitly mark it as "Unknown / needs confirmation".
- Do not silently assume conventional architecture.
- Inspect actual source code, routes, components, database schemas/models, API handlers, authentication, authorization, configuration, package files, and deployment configuration before writing documentation.

PROJECT CONTEXT:

This application is evolving from a Dharwin-specific project management system into a GENERAL-PURPOSE PROJECT MANAGEMENT SYSTEM.

The target product should support organizations that manage:

Organization
  → Clients
  → Projects
  → Teams
  → Members
  → Tasks
  → Tickets / Issues
  → Workflows
  → Environments
  → Roles & Permissions
  → Activity / Audit Logs

The system should not be architecturally tied to Dharwin-specific products, teams, or workflows.

It should eventually support multiple clients, projects, teams, products/modules, environments, and user roles.

The system also needs centralized access control where authorized administrators can manage:

- Users
- Roles
- Permissions
- Product/module access
- Project access
- Environment access
- Team membership
- Audit logs

Example access model:

User
  → Role
  → Product/Module
  → Project
  → Environment
  → Permissions

Examples:

- A Product Admin can manage an assigned product across multiple projects.
- A Developer may have Development and Staging access but no Production access.
- A Tester may have Testing/Staging access but no Production access.
- A Support user may have restricted project/customer access.
- A Read-Only user can view but cannot modify data.
- Production access must be explicitly granted and should never be automatically inherited by testers/developers.

==================================================
PHASE 1 — REPOSITORY ANALYSIS
==================================================

Before writing documentation, inspect the repository systematically.

Inspect:

1. package.json / package-lock / pnpm-lock / yarn.lock
2. frontend structure
3. backend structure
4. routes
5. API endpoints
6. database schemas/models
7. migrations
8. authentication
9. authorization / RBAC
10. middleware
11. services
12. repositories/data access
13. state management
14. reusable components
15. styling system
16. design tokens
17. forms
18. modals
19. navigation
20. project management features
21. ticket/issue management
22. team management
23. user management
24. task management
25. environments
26. audit/activity logging
27. file uploads
28. notifications
29. search/filtering
30. pagination
31. error handling
32. validation
33. tests
34. Docker configuration
35. CI/CD
36. deployment configuration
37. environment variables
38. external services
39. feature flags
40. any existing documentation

Search the repository for architecture-relevant concepts such as:

auth
authentication
authorization
role
permission
user
team
project
client
ticket
issue
task
workflow
environment
audit
activity
notification
api
route
middleware
database
schema
model
migration
service
repository
component
modal
form
navigation

Trace important flows from UI → API → business logic → database.

==================================================
PHASE 2 — CREATE DOCUMENTATION
==================================================

Create the following documentation files.

--------------------------------------------------
/docs/ARCHITECTURE.md
--------------------------------------------------

Document the actual technical architecture.

Include:

1. Architecture overview
2. Technology stack
3. High-level system diagram
4. Frontend architecture
5. Backend architecture
6. Database architecture
7. Authentication architecture
8. Authorization architecture
9. API architecture
10. Service/data-access architecture
11. State management
12. File/storage architecture
13. Notification architecture
14. Search architecture
15. Logging and monitoring
16. External integrations
17. Deployment architecture
18. Environment architecture
19. Request lifecycle
20. Important data flows
21. Module boundaries
22. Current technical limitations
23. Known technical debt

Use Mermaid diagrams where useful.

For example:

Client
  ↓
Frontend
  ↓
API
  ↓
Middleware
  ↓
Authorization
  ↓
Business Logic
  ↓
Data Access
  ↓
Database

Do not use this diagram unless it matches the actual implementation. Adjust it based on the repository.

--------------------------------------------------
/docs/DESIGN.md
--------------------------------------------------

Document the application's UI/UX design system.

Inspect the existing UI before writing this.

Document:

1. Design philosophy
2. Visual language
3. Color system
4. Typography
5. Spacing
6. Border radius
7. Shadows
8. Buttons
9. Inputs
10. Selects
11. Checkboxes
12. Tables
13. Cards
14. Modals
15. Drawers
16. Popovers
17. Dropdowns
18. Navigation
19. Sidebar
20. Tabs
21. Toasts
22. Empty states
23. Loading states
24. Error states
25. Confirmation dialogs
26. Forms
27. Responsive behavior
28. Mobile behavior
29. Accessibility
30. Animation and transition guidelines

Document existing design patterns instead of inventing a new design system.

Also document UX principles such as:

- Prefer progressive disclosure.
- Avoid unnecessary nested modals.
- Keep important actions visible.
- Use consistent spacing.
- Avoid visually noisy interfaces.
- Keep forms focused.
- Use clear hierarchy.
- Make destructive actions explicit.
- Maintain consistent interaction patterns.

--------------------------------------------------
/docs/DATA_MODEL.md
--------------------------------------------------

Document the actual database/data model.

For every important entity document:

- Name
- Purpose
- Fields
- Types
- Required/optional
- Relationships
- Foreign keys
- Indexes
- Unique constraints
- Lifecycle
- Soft deletion if applicable

Focus especially on:

Organization
Client
Project
User
Team
TeamMember
Role
Permission
Product/Module
Environment
ProjectMember
Task
Ticket/Issue
Workflow
Comment
Attachment
Notification
AuditLog

Only document entities that actually exist.

For entities that are planned but not implemented, clearly mark:

STATUS: PLANNED

Add an ER diagram using Mermaid.

--------------------------------------------------
/docs/API.md
--------------------------------------------------

Document the actual API.

For each API area include:

- endpoint
- HTTP method
- authentication requirement
- authorization requirement
- request parameters
- request body
- response
- errors
- pagination
- filtering
- sorting

Group APIs logically:

Authentication
Users
Teams
Clients
Projects
Tasks
Tickets
Workflows
Roles
Permissions
Environments
Audit Logs
Notifications

Do not invent endpoints.

--------------------------------------------------
/docs/RBAC.md
--------------------------------------------------

Create a dedicated access-control specification.

Document the CURRENT authorization implementation first.

Then document the desired generalized authorization model separately.

Recommended conceptual model:

User
  ↓
Role
  ↓
Permissions
  ↓
Scope
  ├── Organization
  ├── Client
  ├── Project
  ├── Team
  ├── Product/Module
  └── Environment

Document roles such as:

Super Admin
Product Admin
Project Manager
Developer
Tester
Support
Read-Only

But only mark them as implemented if they actually exist.

Document:

- role assignment
- permission assignment
- project-level access
- team-level access
- environment-level access
- production access
- access inheritance
- access revocation
- audit logging

Important security principle:

Production access must be explicit and must not automatically be inherited by development/testing roles.

--------------------------------------------------
/docs/PROJECT_MODEL.md
--------------------------------------------------

Define how the general PMS should conceptually model:

Organization
  ↓
Client
  ↓
Project
  ↓
Teams
  ↓
Members
  ↓
Tasks / Tickets
  ↓
Workflow
  ↓
Environment

Explain:

- Client vs Project
- Global vs project-scoped teams
- Project members
- Team members
- Project roles
- Ticket ownership
- Task ownership
- Project environments
- Project lifecycle

Separate CURRENT implementation from RECOMMENDED future model.

--------------------------------------------------
/docs/FEATURES.md
--------------------------------------------------

Create a product feature inventory.

For every feature record:

Feature
Status
Location
Description
Dependencies
Known issues
Future improvements

Use statuses:

IMPLEMENTED
PARTIAL
PLANNED
DEPRECATED

Include:

- Dashboard
- Projects
- Clients
- Teams
- Members
- Tasks
- Tickets
- Workflows
- Comments
- Attachments
- Notifications
- Access Control
- Audit Logs
- Environments
- Search
- Filters
- Reports
- Settings

Only include features actually supported by the repository as IMPLEMENTED.

--------------------------------------------------
/docs/UI_COMPONENTS.md
--------------------------------------------------

Create a reusable component catalog.

Inspect the actual frontend components.

Document:

- component name
- location
- purpose
- props
- variants
- usage rules
- accessibility considerations

Pay special attention to:

Button
Input
Select
Combobox
Search
Modal
Drawer
Popover
Dropdown
Tabs
Table
Card
Avatar
Badge
Toast
Tooltip
Date Picker
User Picker
Team Picker
Project Picker
Status Picker
Comment Box
File Upload
Pagination

Also document which components SHOULD be reused instead of creating duplicates.

--------------------------------------------------
/docs/SECURITY.md
--------------------------------------------------

Document:

Authentication
Authorization
RBAC
Session management
Password handling
Secrets
Environment variables
API security
Input validation
File upload security
Rate limiting if present
Audit logs
Production access
Sensitive customer data
Error handling
Logging
CORS
CSRF if applicable

Clearly identify security gaps.

--------------------------------------------------
/docs/TESTING.md
--------------------------------------------------

Document the current testing strategy.

Include:

Unit tests
Integration tests
API tests
Component tests
E2E tests
Authentication tests
Authorization tests
Critical business workflows

Identify areas with insufficient coverage.

--------------------------------------------------
/docs/DEPLOYMENT.md
--------------------------------------------------

Document:

Development
Staging
Production

Include:

- build process
- deployment process
- environment variables
- database configuration
- external services
- CI/CD
- migrations
- rollback strategy
- logging
- monitoring

Only document what exists.

--------------------------------------------------
/docs/ADR.md
--------------------------------------------------

Create an Architecture Decision Record document.

Record major existing architectural decisions discovered in the repository.

Format:

## ADR-001: Decision title

Status:
Date:

Context:

Decision:

Reason:

Consequences:

Alternatives considered:

If the reason cannot be determined from the repository, explicitly say:

"Reason not documented in the codebase."

Do not invent historical reasoning.

==================================================
PHASE 3 — README
==================================================

Improve or create the root README.md.

It should contain:

1. Product overview
2. Main capabilities
3. Architecture overview
4. Technology stack
5. Repository structure
6. Local development setup
7. Environment variables
8. Database setup
9. Running frontend
10. Running backend
11. Testing
12. Deployment
13. Links to /docs
14. Contribution guidelines

Do not overwrite useful existing README information without preserving it.

==================================================
PHASE 4 — DOCUMENTATION QUALITY
==================================================

After creating all documentation:

1. Cross-check every document against the source code.
2. Remove contradictions.
3. Make terminology consistent.
4. Make sure entity names match the code.
5. Make sure API names match the code.
6. Make sure database names match the code.
7. Separate current implementation from future recommendations.
8. Mark uncertain information clearly.
9. Do not claim planned functionality is implemented.
10. Avoid unnecessary generic software architecture theory.

The documentation should be useful to another developer joining the project tomorrow.

==================================================
FINAL OUTPUT
==================================================

After creating the files, provide a concise report:

1. Files created
2. Files updated
3. Current architecture summary
4. Current technology stack
5. Important architectural findings
6. Major technical debt
7. Missing documentation
8. Security concerns discovered
9. Recommended next architectural improvements

DO NOT modify application code.
ONLY create/update documentation files.
```

## One more file I'd strongly recommend

For your particular project, I'd add:

```text
/docs/PRODUCT_PRINCIPLES.md
```

This is different from architecture.

It tells Cursor **what the product is supposed to be**, so six months from now it doesn't turn your PMS back into a Dharwin-specific ticket system.

Put something like:

```md
# Product Principles

## 1. General-purpose PMS

The system must not depend on Dharwin-specific terminology,
products, teams, or workflows.

## 2. Client-first

A client can have multiple projects.

## 3. Project-scoped work

Tasks, tickets, teams, workflows and environments can be
associated with a specific project.

## 4. Flexible teams

Teams can be:
- Organization-wide
- Project-specific

## 5. Explicit access

Users should only receive access explicitly granted to them.

## 6. Production is protected

Development and testing access must not automatically grant
production access.

## 7. Reusable UI

New screens should reuse existing components and design tokens.

## 8. Progressive disclosure

Do not expose every advanced option by default.

## 9. Auditability

Important administrative and access changes should be traceable.

## 10. Avoid hard-coded product assumptions

Do not hard-code:
- Dharwin
- ATS
- AI Agents
- Web Team
- QA Team
- specific client names

unless they are actual user-created data.
```

### I'd ultimately aim for this

```text
project/
│
├── README.md
├── .env.example
│
├── docs/
│   ├── PRODUCT_PRINCIPLES.md   ← What the product is
│   ├── ARCHITECTURE.md         ← How the system works
│   ├── DESIGN.md               ← How the UI works
│   ├── PROJECT_MODEL.md        ← How the business entities work
│   ├── DATA_MODEL.md           ← How data is stored
│   ├── API.md                  ← How systems communicate
│   ├── RBAC.md                 ← Who can access what
│   ├── UI_COMPONENTS.md        ← Reusable UI
│   ├── SECURITY.md             ← Security rules
│   ├── FEATURES.md             ← Product roadmap/state
│   ├── TESTING.md              ← Testing strategy
│   ├── DEPLOYMENT.md           ← Environments/deployment
│   └── ADR.md                  ← Why architecture decisions exist
│
└── src/
    └── ...
```

**The key distinction I'd enforce in all of these docs is `CURRENT` vs `TARGET`.** Your PMS is currently transitioning from a Dharwin-specific system to a general client/project-based PMS. If Cursor mixes those two states, it can easily "document" features that don't actually exist and then start coding against those imaginary assumptions.

---

## Status

Saved for reference only — none of `/docs/*.md`, the README rewrite, or `.env.example`
have been generated yet. `ARCHITECTURE.md` already exists at the repo root (created
earlier this session); this plan's version would live under `/docs` and go considerably
deeper (data model, API, RBAC, etc.) — decide whether to keep both or consolidate before
generating the rest.
