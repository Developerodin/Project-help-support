'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getTeam, patchTeam } from '@/shared/api/teams.js';
import { listProjects } from '@/shared/api/projects.js';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import { validateNewTeamDraft } from '@/shared/lib/validate-new-team.js';
import { showToast } from '@/shared/lib/toast.js';

export default function EditTeamPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id;

  const [draft, setDraft] = useState({ name: '', project: '' });
  const [teamName, setTeamName] = useState('');
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([getTeam(teamId), listProjects()])
      .then(([team, projectsPage]) => {
        setTeamName(team.name);
        setDraft({
          name: team.name,
          project: team.project?.id ?? '',
        });
        setProjects(projectsPage.results.filter((proj) => proj.status === 'active'));
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [teamId]);

  const nameLen = draft.name.trim().length;
  const validation = useMemo(() => validateNewTeamDraft(draft), [draft]);
  const nameInvalid = showValidation && validation.errors.some((e) => e.field === 'name');
  const nameError = validation.errors.find((e) => e.field === 'name');

  const focusFirstInvalid = useCallback((result) => {
    const id = result?.firstFieldId;
    if (!id) return;
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  }, []);

  const set = (key) => (event) => {
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  };

  function closeValidationDialog() {
    setValidationDialogOpen(false);
    focusFirstInvalid(validateNewTeamDraft(draft));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    const result = validateNewTeamDraft(draft);
    if (!result.valid) {
      setValidationItems(result.summaryItems);
      setValidationDialogOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await patchTeam(teamId, { name: draft.name.trim(), project: draft.project || null });
      showToast('Team updated');
      router.push('/teams');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="meta" role="status">Loading team…</p>;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Edit team</h1>
          <p className="sub">
            {teamName ? `Update ${teamName}. Members are managed from the Teams page.` : 'Update team details.'}
          </p>
        </div>
      </div>

      <FormError error={error} />

      <div className="formgrid new-ticket-grid">
        <form className="form new-ticket-form" id="editTeam" onSubmit={onSubmit} noValidate>
          <section className="new-ticket-block" aria-labelledby="team-details-heading">
            <h2 id="team-details-heading" className="form-section">Team details</h2>
            <p className="form-hint">Name the team and choose whether it applies to all projects or one.</p>

            <div className={`form-row${nameInvalid ? ' bad' : ''}`}>
              <label htmlFor="ntn">Team name <span className="req" aria-hidden="true">*</span></label>
              <input
                id="ntn"
                required
                maxLength={120}
                placeholder="e.g. Platform"
                value={draft.name}
                onChange={set('name')}
                aria-invalid={nameInvalid}
                aria-describedby="ntn-hint"
              />
              <p id="ntn-hint" className={`field-hint${nameInvalid ? ' invalid' : ''}`}>
                {nameInvalid
                  ? (nameError?.message ?? 'Required.')
                  : `${nameLen}/120 characters`}
              </p>
              <span className="help">Shown on team cards and ticket routing pickers.</span>
            </div>

            <div className="form-row">
              <label htmlFor="ntp">Project scope</label>
              <select
                id="ntp"
                value={draft.project}
                onChange={set('project')}
                aria-describedby="ntp-hint"
              >
                <option value="">Global (all projects)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p id="ntp-hint" className="field-hint">Optional</p>
              <span className="help">
                Global teams can be assigned on any project. Project teams only appear for that project.
              </span>
            </div>
          </section>

          <div className="form-foot new-ticket-foot">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="btn" onClick={() => router.back()} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>

        <aside className="formside" aria-label="Team setup notes">
          <div className="panel">
            <header><h3>Global vs project teams</h3></header>
            <p className="note-line">
              Global teams work across every project. Use them for groups like Platform or QA that
              handle work from multiple products.
            </p>
          </div>

          <div className="panel">
            <header><h3>Project teams</h3></header>
            <p className="note-line">
              Project-scoped teams only show up when filing or routing tickets in that project.
              Use them when a squad owns one product exclusively.
            </p>
          </div>

          <div className="panel">
            <header><h3>Members</h3></header>
            <p className="note-line">
              Add or remove people from the Teams page. Changing scope does not remove existing members.
            </p>
          </div>
        </aside>
      </div>

      {showValidation && !validation.valid ? (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
            overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
          }}
        >
          {validation.liveMessage}
        </div>
      ) : null}

      <ValidationDialog
        open={validationDialogOpen}
        title="Fill in required fields"
        message="Complete the highlighted fields before saving this team."
        items={validationItems}
        onClose={closeValidationDialog}
      />
    </>
  );
}
