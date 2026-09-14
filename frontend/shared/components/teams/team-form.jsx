'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import { initials } from '@/shared/components/icons.jsx';
import MemberList from '@/shared/components/teams/member-list.jsx';
import MemberPicker from '@/shared/components/teams/member-picker.jsx';
import { validateNewTeamDraft } from '@/shared/lib/validate-new-team.js';

const COPY = {
  create: {
    title: 'Create a team',
    sub: 'Create a team to organize work, route tickets, and manage people.',
    crumb: 'New team',
    submit: 'Create team',
    submitting: 'Creating…',
    dialog: 'Complete the highlighted fields before creating this team.',
    membersHint: 'Add people who should belong to this team.',
  },
  edit: {
    title: 'Team settings',
    sub: "Manage this team's configuration and members.",
    crumb: 'Settings',
    submit: 'Save changes',
    submitting: 'Saving…',
    dialog: 'Complete the highlighted fields before saving this team.',
    membersHint: 'Manage the people assigned to this team.',
  },
};

function GlobeGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.7 1.8 2.6 3.8 2.6 6S9.7 12.2 8 14C6.3 12.2 5.4 10.2 5.4 8S6.3 3.8 8 2Z" />
    </svg>
  );
}

function TargetGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SCOPES = [
  {
    value: 'global',
    glyph: <GlobeGlyph />,
    title: 'Global team',
    blurb: 'Available across all projects. Best for shared functions such as Design, QA, Platform or Support.',
  },
  {
    value: 'project',
    glyph: <TargetGlyph />,
    title: 'Project team',
    blurb: 'Limited to one project. Best for squads working exclusively on a single product or client.',
  },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The one form behind both /teams/new and /teams/[id]/edit. The page owns the
 * data (loading the team, calling the API); this owns the draft, validation and
 * layout so the two routes can never drift apart visually.
 *
 * Members differ by mode and only by mode: on create they live in local state
 * and ship with the POST (the create endpoint takes `members`), on edit the
 * page owns them because each change is its own PATCH.
 */
export default function TeamForm({
  mode,
  team = null,
  projects = [],
  projectsLoading = false,
  projectsError = false,
  busy = false,
  error = null,
  memberBusy = null,
  memberNotice = null,
  onSubmit,
  onCancel,
  onAddMembers,
  onRemoveMember,
}) {
  const copy = COPY[mode];
  const isEdit = mode === 'edit';
  const initialName = team?.name ?? '';
  const initialProject = team?.project?.id ?? '';

  const [draft, setDraft] = useState({
    name: initialName,
    project: initialProject,
    scope: initialProject ? 'project' : 'global',
  });
  const [picked, setPicked] = useState([]);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);

  const members = isEdit ? (team?.members ?? []) : picked;
  const excludeMemberIds = useMemo(() => members.map((m) => m.id), [members]);

  const validation = useMemo(() => validateNewTeamDraft(draft), [draft]);
  const invalid = (field) => showValidation && validation.errors.some((e) => e.field === field);
  const messageFor = (field) => validation.errors.find((e) => e.field === field)?.message;
  const nameInvalid = invalid('name');
  const projectInvalid = invalid('project');

  const dirty = isEdit
    && (draft.name !== initialName || (draft.scope === 'project' ? draft.project : '') !== initialProject);

  const focusFirstInvalid = useCallback((result) => {
    const id = result?.firstFieldId;
    if (!id) return;
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  }, []);

  function closeValidationDialog() {
    setValidationDialogOpen(false);
    focusFirstInvalid(validateNewTeamDraft(draft));
  }

  function handleAdd(ids, pickedUsers = []) {
    if (isEdit) return onAddMembers(ids, pickedUsers);
    const byId = new Map(pickedUsers.map((u) => [u.id, u]));
    const next = ids.map((id) => byId.get(id) || { id, name: 'Unknown' });
    setPicked((prev) => {
      const have = new Set(prev.map((m) => m.id));
      return [...prev, ...next.filter((u) => !have.has(u.id))];
    });
    return undefined;
  }

  function handleRemove(member) {
    // A pick that was never saved has no consequence to confirm.
    if (!isEdit) {
      setPicked((prev) => prev.filter((m) => m.id !== member.id));
      return;
    }
    setConfirmRemove(member);
  }

  async function confirmRemoval() {
    const member = confirmRemove;
    setConfirmRemove(null);
    await onRemoveMember(member);
  }

  function handleSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    const result = validateNewTeamDraft(draft);
    if (!result.valid) {
      setValidationItems(result.summaryItems);
      setValidationDialogOpen(true);
      return;
    }
    const payload = {
      name: draft.name.trim(),
      project: draft.scope === 'project' ? draft.project : null,
    };
    if (!isEdit) payload.members = picked.map((m) => m.id);
    onSubmit(payload);
  }

  return (
    <div className="team-form-page">
      <nav className="crumb" aria-label="Breadcrumb">
        <Link href="/teams">Teams</Link>
        {isEdit && team?.name ? (
          <>
            <span aria-hidden="true">/</span>
            <span>{team.name}</span>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{copy.crumb}</span>
      </nav>

      <div className="page-head team-form-head">
        <div>
          <h1>{isEdit ? (team?.name || copy.title) : copy.title}</h1>
          <p className="sub">{copy.sub}</p>
        </div>
      </div>

      <FormError error={error} />

      <div className="team-form-grid">
        <form
          className="panel team-form-card"
          id={isEdit ? 'editTeam' : 'newTeam'}
          onSubmit={handleSubmit}
          noValidate
        >
          <header className="team-form-card__head">
            <h2>Team details</h2>
            <p>Set up the team and decide where it can be used.</p>
          </header>

          <div className="team-form-card__body">
            <div className={`form-row${nameInvalid ? ' bad' : ''}`}>
              <label htmlFor="ntn">Team name <span className="req" aria-hidden="true">*</span></label>
              <input
                id="ntn"
                required
                maxLength={120}
                placeholder="e.g. Platform Team"
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                aria-invalid={nameInvalid}
                aria-describedby="ntn-hint"
                disabled={busy}
              />
              {nameInvalid ? (
                <p id="ntn-hint" className="field-hint invalid">{messageFor('name') ?? 'Required.'}</p>
              ) : (
                <p id="ntn-hint" className="field-hint">
                  <span>A clear name helps people identify the team when assigning work.</span>
                  <span className="team-form-counter num">{draft.name.trim().length}/120</span>
                </p>
              )}
            </div>

            <fieldset className="team-scope" disabled={busy}>
              <legend className="team-form-legend">Team scope</legend>
              <div className="team-scope__options">
                {SCOPES.map((option) => (
                  <label
                    key={option.value}
                    className={`team-scope-card${draft.scope === option.value ? ' is-on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="team-scope"
                      value={option.value}
                      checked={draft.scope === option.value}
                      onChange={() => setDraft((prev) => ({ ...prev, scope: option.value }))}
                    />
                    <span className="team-scope-card__glyph" aria-hidden="true">{option.glyph}</span>
                    <span className="team-scope-card__body">
                      <b>{option.title}</b>
                      <span>{option.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="field-hint">
                {draft.scope === 'global'
                  ? 'This team can receive work from any project.'
                  : 'This team is available only for the selected project.'}
              </p>
            </fieldset>

            {draft.scope === 'project' ? (
              <div className={`form-row team-scope-reveal${projectInvalid ? ' bad' : ''}`}>
                <label htmlFor="ntp">Project</label>
                <select
                  id="ntp"
                  value={draft.project}
                  onChange={(e) => setDraft((prev) => ({ ...prev, project: e.target.value }))}
                  aria-invalid={projectInvalid}
                  aria-describedby="ntp-hint"
                  disabled={busy || projectsLoading}
                >
                  <option value="">
                    {projectsLoading ? 'Loading projects…' : 'Select project'}
                  </option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p id="ntp-hint" className={`field-hint${projectInvalid ? ' invalid' : ''}`}>
                  {projectInvalid
                    ? (messageFor('project') ?? 'Required.')
                    : projectsError
                      ? 'Projects could not be loaded. Reload the page to try again.'
                      : 'Only active projects are listed.'}
                </p>
              </div>
            ) : null}

            <section className="team-members-block" aria-labelledby="team-members-heading">
              <div className="team-members-block__head">
                <div>
                  <h3 id="team-members-heading" className="team-form-legend">Team members</h3>
                  <p className="field-hint">
                    {members.length > 0 ? plural(members.length, 'member') : copy.membersHint}
                  </p>
                </div>
                <span className="spacer" />
                <MemberPicker
                  variant="action"
                  triggerLabel="Add members"
                  serverSearch
                  excludeMemberIds={excludeMemberIds}
                  busy={memberBusy === 'add'}
                  onConfirm={handleAdd}
                />
              </div>

              {memberNotice ? (
                <p className="member-notice" role="alert">
                  <span>{memberNotice.message}</span>
                  {memberNotice.onRetry ? (
                    <button type="button" className="btn btn-sm" onClick={memberNotice.onRetry}>
                      Retry
                    </button>
                  ) : null}
                </p>
              ) : null}

              {members.length === 0 ? (
                <div className="member-empty">
                  <b>No members added yet</b>
                  <span>Add people who should work on this team&apos;s tickets.</span>
                </div>
              ) : (
                <MemberList
                  members={members}
                  onRemove={handleRemove}
                  removeLabel={isEdit ? 'Remove' : '×'}
                  removingId={memberBusy}
                  disabled={busy}
                />
              )}
            </section>
          </div>

          <footer className="team-form-actions">
            <span className="team-form-actions__state" aria-live="polite">
              {dirty ? 'Unsaved changes' : ''}
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? copy.submitting : copy.submit}
            </button>
          </footer>
        </form>

        <details className="team-context-wrap" open>
          <summary className="team-context-toggle">
            {isEdit ? 'Team overview' : 'About teams'}
          </summary>
          <aside className="panel team-context" aria-label="Team setup notes">
            {isEdit ? (
              <>
                <h3>Team overview</h3>
                <dl className="team-context__facts">
                  <div>
                    <dt>Scope</dt>
                    <dd>
                      {team?.project ? 'Project team' : 'Global team'}
                      <span className="meta">
                        {team?.project ? team.project.name : 'All projects'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Members</dt>
                    <dd>
                      {members.length}
                      <span className="meta">
                        {members.length === 1 ? 'person' : 'people'} on this team
                      </span>
                    </dd>
                  </div>
                </dl>
                {team?.lead ? (
                  <div className="team-context__section">
                    <h4>Lead</h4>
                    <p className="team-context__person">
                      <span className="avatar sm">{initials(team.lead.name)}</span>
                      {team.lead.name}
                    </p>
                  </div>
                ) : null}
                <div className="team-context__section">
                  <h4>Changing scope</h4>
                  <p>
                    Moving a team between global and project scope changes where it can be
                    assigned. It never removes existing members.
                  </p>
                </div>
                <div className="team-context__section">
                  <h4>Members</h4>
                  <p>
                    People on this team can receive work routed to it. Removing someone here
                    only ends their membership — it never deletes their account.
                  </p>
                </div>
              </>
            ) : (
              <>
                <h3>About teams</h3>
                <div className="team-context__section">
                  <h4>Global teams</h4>
                  <p>Work across multiple projects. Use these for shared functions such as:</p>
                  <ul className="team-context__list">
                    <li>Engineering</li>
                    <li>Design</li>
                    <li>QA</li>
                    <li>Support</li>
                  </ul>
                </div>
                <div className="team-context__section">
                  <h4>Project teams</h4>
                  <p>
                    Belong to a single project. Use these when a team works exclusively on one
                    client or product — they only appear when filing or routing tickets there.
                  </p>
                </div>
                <div className="team-context__section">
                  <h4>Members</h4>
                  <p>
                    People assigned to this team can receive work routed to the team. They are
                    saved together with the team.
                  </p>
                </div>
              </>
            )}
          </aside>
        </details>
      </div>

      {showValidation && !validation.valid ? (
        <div role="alert" aria-live="assertive" className="sr-only">
          {validation.liveMessage}
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title={confirmRemove ? `Remove ${confirmRemove.name}?` : ''}
        message="They will no longer be part of this team and may no longer receive work routed to it. Their account is not affected."
        confirmLabel="Remove member"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmRemoval}
        onCancel={() => setConfirmRemove(null)}
      />

      <ValidationDialog
        open={validationDialogOpen}
        title="Fill in required fields"
        message={copy.dialog}
        items={validationItems}
        onClose={closeValidationDialog}
      />
    </div>
  );
}
