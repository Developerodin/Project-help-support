# UI Component Catalog

All reusable frontend components live under `frontend/shared/components/`. Pages under
`frontend/app/` should compose these rather than re-implementing markup — see the "Reuse
instead of rebuilding" note on each entry below. Props are read directly from each
component's destructured signature; where a signature spans many lines only the notable
props are called out.

## `ui/` — low-level primitives (shadcn/ui-derived, Tailwind + `class-variance-authority`)

| Component | File | Purpose |
|---|---|---|
| `Button` | `ui/button.jsx` | CVA-based button with variants; the Tailwind counterpart to `.btn` in design-system.css |
| `Input` | `ui/input.jsx` | Styled `<input>` |
| `Separator` | `ui/separator.jsx` | Radix `@radix-ui/react-separator` wrapper |
| `Sheet`, `SheetTrigger`, `SheetClose`, `SheetPortal`, `SheetOverlay`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription` | `ui/sheet.jsx` | Radix Dialog-based slide-in panel primitive set — powers the sidebar's mobile mode |
| `Skeleton` | `ui/skeleton.jsx` | Loading placeholder block (Tailwind equivalent of `.sk` in design-system.css) |
| `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent` | `ui/tooltip.jsx` | Radix `@radix-ui/react-tooltip` wrapper |
| `Sidebar`, `SidebarProvider`, `SidebarTrigger`, `SidebarRail`, `SidebarInset`, `SidebarInput`, `SidebarHeader`, `SidebarFooter`, `SidebarSeparator`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupAction`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuSkeleton`, `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton`, `useSidebar` | `ui/sidebar.jsx` | Full shadcn/ui sidebar primitive set — the collapsible app nav shell lives on top of this |

**Reuse instead of rebuilding:** any new collapsible/off-canvas panel should reuse `Sheet`;
any new nav rail should extend `Sidebar`, not hand-roll a second nav shell. Note this is the
one place in the app that is Tailwind-first — see `docs/DESIGN.md` §1 for the mixed-styling
context.

## Top-level shared components

| Component | File | Purpose / props |
|---|---|---|
| `AppLoader` | `app-loader.jsx` | Full-page/section loading indicator |
| `AppSidebar` | `app-sidebar.jsx` | The primary nav rail, mounted once from `app/(app)/layout.jsx`; builds on `ui/sidebar.jsx` |
| `AttachmentPicker` | `attachment-picker.jsx` | File picker with drag-and-drop. Props: `files, onChange, onAddFiles, errors, disabled, idPrefix` |
| `AttachmentUploadLoader` | `attachment-upload-loader.jsx` | Upload-in-progress indicator for attachments |
| `BrandMark` | `brand-mark.jsx` | The PROWPLUS logo/wordmark. Props: `className` |
| `ConfirmDialog` | `confirm-dialog.jsx` | Generic yes/no confirmation modal. Props: `open, title, message, confirmLabel, cancelLabel, danger, busy, onConfirm, onCancel` |
| `FormError` | `form-error.jsx` | Inline form-level error message. Props: `error` |
| `Icon` (+ `initials`, `priorityChipClass`, `priorityLabel`, `isOverdue` helpers) | `icons.jsx` | Central icon registry (`Icon({ name, size })`) and small ticket-domain formatting helpers — reuse these helpers instead of re-deriving priority labels/classes or overdue checks elsewhere |
| `InviteDialog` | `invite-dialog.jsx` | Email + role invite form modal. Props: `open, email, role, error, busy, onEmailChange, onRoleChange, onConfirm, onCancel` |
| `NotificationBell` | `notification-bell.jsx` | Topbar notification icon + unread badge, fetches its own count |
| `ProfileMenu` | `profile-menu.jsx` | Topbar user menu (profile, sign out) |
| `ProjectModulesEditor` | `project-modules-editor.jsx` | Editor for a project's module/page taxonomy (backed by `@pms/shared`'s `module-catalog.js`) |
| `ProjectSwitcher` | `project-switcher.jsx` | Topbar active-project selector |
| `RemarkDialog` | `remark-dialog.jsx` | Single-textarea modal (e.g. reopen/block remarks). Props: `open, title, label, confirmLabel, cancelLabel, busy, value, onChange, onConfirm, onCancel` |
| `ThemeToggle` | `theme-toggle.jsx` | Light/dark theme switch (topbar) |
| `ValidationDialog` | `validation-dialog.jsx` | Lists missing/invalid required fields before a blocked submit. Props: `open, title, message, items, onClose` |

**Reuse instead of rebuilding:** `ConfirmDialog`, `RemarkDialog`, and `ValidationDialog` cover
the three modal shapes the design system allows (confirm, single short field, validation
summary — see `docs/DESIGN.md` §5). A new feature needing "are you sure" or "one field" should
reuse these, not add a fourth bespoke dialog component.

## `auth/` — signed-out surface

| Component | File | Purpose |
|---|---|---|
| `AuthFrame` (default), `AuthBrand` | `auth-shell.jsx` | Page shell + brand lockup for login/forgot/reset/invite-accept |
| `AuthError` | `auth-error.jsx` | Error banner styled for the dark auth palette. Props: `error, tone, children` |
| `AuthField` | `auth-field.jsx` | Labeled input field styled for auth forms |
| `AuthIcon` | `auth-icons.jsx` | Icon set scoped to auth screens |
| `AuthBackground` | `auth-background.jsx` | Animated Three.js (`three`) graph/workflow visualization behind the auth split-screen; large, self-contained, not reused elsewhere |

## `teams/`

| Component | File | Purpose / props |
|---|---|---|
| `TeamForm` | `team-form.jsx` | Shared form shell used by both `/teams/new` and `/teams/[id]/edit`. Props: `mode, team, projects, projectsLoading, projectsError, users, usersLoading, busy, error, memberBusy, memberNotice, onSubmit, …` |
| `TeamCard` | `team-card.jsx` | Team summary card (stats row, lead, member list) used on the teams list page. Props: `team, users, onAddMembers, onRequestRemove, addBusy, removingMemberId` |
| `MemberList` | `member-list.jsx` | Renders/collapses a team's member rows (collapses after a threshold, expandable). Props: `members, onRemove, removeLabel, removingId, disabled` |
| `MemberPicker` | `member-picker.jsx` | People-picker popover (search + multi-select + confirm) — the `.member-picker`/`.mp-*` pattern in `docs/DESIGN.md` §5. Props: `available, loading, busy, onConfirm, title, subtitle, variant, triggerLabel, busyLabel` |

**Reuse instead of rebuilding:** `MemberPicker` is the one people-picker in the app — any
future "assign a person/team" UI (e.g. project members, ticket watchers) should extend or
reuse it rather than building a second popover-with-search component. `TeamForm` is the
pattern to copy for any other "shared form between a `new/` and `[id]/edit/` page" need.

## `tickets/`

| Component | File | Purpose |
|---|---|---|
| `BoardLane` | `board-lane.jsx` | One column of the ticket kanban board (drop target + card list) |
| `TicketCard` | `ticket-card.jsx` | Board card for a single ticket |
| `TicketTable` | `ticket-table.jsx` | Sortable/paginated ticket list table |
| `TicketFilters` | `ticket-filters.jsx` | Filter bar (status/scope/search) above the board or table |
| `StatsStrip` | `stats-strip.jsx` | Metric strip (counts per lane) above the board |
| `TicketDetailDrawer` (+ internal `TicketDrawerContent`) | `ticket-detail-drawer.jsx` | The side drawer shown when opening a ticket; composes most of the components below |
| `TicketHeader` | `ticket-header.jsx` | Drawer header: id, title, close, watch toggle |
| `TicketStageBar` | `ticket-stage-bar.jsx` | Interactive pipeline rail (`.railboard`) for advancing/reopening a ticket's stage |
| `TicketDrawerFooter` | `ticket-drawer-footer.jsx` | Drawer footer with the primary stage-transition action |
| `TicketDetailsTab` (+ `DetailField`, `PersonValue`, `EmptyValue`, `AssignmentSelect`) | `ticket-details-tab.jsx` | Read/edit view of ticket metadata fields |
| `TicketMetadataRail` | `ticket-metadata-rail.jsx` | Sticky sidebar column (assignee, dates, watchers) — the `.sidecol`/`.siderow` pattern |
| `TicketRailPicker` | `ticket-rail-picker.jsx` | Dropdown for picking a target pipeline stage |
| `TicketHistory` | `ticket-history.jsx` | Audit trail / activity timeline (`.trail`) for a ticket |
| `TicketComments` | `ticket-comments.jsx` | Comment thread + composer, including inline attachment comments |
| `TicketAttachments`, `TicketAttachmentLink`, `TicketAttachmentImage`, `useAttachmentDownloadUrl` | `ticket-attachments.jsx`, `ticket-attachment.jsx` | Attachment list rendering and signed-download-URL fetching hook |

**Reuse instead of rebuilding:** ticket components are already fairly decomposed by concern
(header/rail/tabs/footer/history/comments) — a new ticket-drawer feature should add a tab or
rail section rather than growing `TicketDetailDrawer` directly. `TicketAttachments`/
`useAttachmentDownloadUrl` is the one attachment pattern; reuse it if attachments are ever
added to another entity (e.g. teams, projects).

## Snapshot

46 component files under `frontend/shared/components/` (excluding `__tests__/`): 22 in
`tickets/`, 10 shared at the root, 6 in `ui/`, 5 in `auth/`, 4 in `teams/`. No component
inventory existed before this document — counts and prop lists above were read directly from
source on 2026-08-17 and will drift as the app changes; re-derive rather than trust this file
blindly after significant frontend work.
