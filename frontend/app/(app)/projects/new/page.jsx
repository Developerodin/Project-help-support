'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { listClients } from '@/shared/api/clients.js';
import { createProject } from '@/shared/api/projects.js';
import { listTeams } from '@/shared/api/teams.js';
import CompanyLogo from '@/shared/components/companies/company-logo.jsx';
import FormError from '@/shared/components/form-error.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import { formRowsToModules } from '@/shared/lib/project-modules.js';
import { validateNewProjectDraft } from '@/shared/lib/validate-new-project.js';
import { showToast } from '@/shared/lib/toast.js';

const INITIAL_DRAFT = {
  clientId: '',
  name: '',
  description: '',
  team: '',
};

export default function NewProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetClientId = searchParams.get('clientId') ?? '';

  const [draft, setDraft] = useState({ ...INITIAL_DRAFT, clientId: presetClientId });
  const [moduleRows, setModuleRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);

  useEffect(() => {
    listClients({ status: 'active' }).then((p) => setCompanies(p.results)).catch(() => {});
    listTeams().then((p) => setTeams(p.results)).catch(() => {});
  }, []);

  useEffect(() => {
    if (presetClientId) {
      setDraft((prev) => ({ ...prev, clientId: presetClientId }));
    }
  }, [presetClientId]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === draft.clientId),
    [companies, draft.clientId],
  );

  const nameLen = draft.name.trim().length;
  const descLen = draft.description.trim().length;
  const validation = useMemo(() => validateNewProjectDraft(draft), [draft]);
  const companyInvalid = showValidation && validation.errors.some((e) => e.field === 'clientId');
  const nameInvalid = showValidation && validation.errors.some((e) => e.field === 'name');
  const companyError = validation.errors.find((e) => e.field === 'clientId');

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
    focusFirstInvalid(validateNewProjectDraft(draft));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    const result = validateNewProjectDraft(draft);
    if (!result.valid) {
      setValidationItems(result.summaryItems);
      setValidationDialogOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body = {
        clientId: draft.clientId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        team: draft.team || null,
        modules: formRowsToModules(moduleRows),
      };
      const created = await createProject(body);
      showToast(`Project ${created.key} created`);
      router.push('/projects');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New project</h1>
          <p className="sub">Add a project under a company with defaults and a module catalog.</p>
        </div>
      </div>

      <FormError error={error} />

      <div className="formgrid new-ticket-grid">
        <form className="form new-ticket-form new-project-form" id="newProject" onSubmit={onSubmit} noValidate>
          <section className="new-ticket-block" aria-labelledby="project-details-heading">
            <h2 id="project-details-heading" className="form-section">Project details</h2>
            <p className="form-hint">Company, project name, and optional description.</p>

            <div className={`form-row${companyInvalid ? ' bad' : ''}`}>
              <label htmlFor="npc">Company <span className="req" aria-hidden="true">*</span></label>
              {selectedCompany ? (
                <div className="company-select-preview">
                  <CompanyLogo company={selectedCompany} size={24} />
                  <span>{selectedCompany.name}</span>
                </div>
              ) : null}
              <select
                id="npc"
                required
                value={draft.clientId}
                onChange={set('clientId')}
                aria-invalid={companyInvalid}
                aria-describedby="npc-hint"
                disabled={Boolean(presetClientId) && companies.some((c) => c.id === presetClientId)}
              >
                <option value="">Select a company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
              <p id="npc-hint" className={`field-hint${companyInvalid ? ' invalid' : ''}`}>
                {companyInvalid
                  ? (companyError?.message ?? 'Invalid company.')
                  : 'Projects always belong to one company.'}
              </p>
            </div>

            <div className={`form-row${nameInvalid ? ' bad' : ''}`}>
              <label htmlFor="npn">Project <span className="req" aria-hidden="true">*</span></label>
              <input
                id="npn"
                required
                maxLength={120}
                placeholder="e.g. Web App"
                value={draft.name}
                onChange={set('name')}
                aria-invalid={nameInvalid}
                aria-describedby="npn-hint"
              />
              <p id="npn-hint" className={`field-hint${nameInvalid ? ' invalid' : ''}`}>
                {nameInvalid
                  ? 'Required.'
                  : `${nameLen}/120 characters`}
              </p>
              <span className="help">The product or app under this company.</span>
            </div>

            <div className="form-row">
              <label htmlFor="npd">Description</label>
              <textarea
                id="npd"
                rows={3}
                maxLength={1000}
                placeholder="Optional - what this project covers"
                value={draft.description}
                onChange={set('description')}
                aria-describedby="npd-hint"
              />
              <p id="npd-hint" className="field-hint">
                {descLen > 0 ? `${descLen}/1000 characters` : 'Optional'}
              </p>
            </div>
          </section>

          <section className="new-ticket-block" aria-labelledby="project-team-heading">
            <h2 id="project-team-heading" className="form-section">Project team</h2>
            <p className="form-hint">
              Assign the team that owns work in this project. Set member roles after creation.
            </p>

            <div className="new-project-defaults-stack">
              <div className="form-row">
                <label htmlFor="npdteam">Project team</label>
                <select
                  id="npdteam"
                  value={draft.team}
                  onChange={set('team')}
                >
                  <option value="">No team assigned</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="help">Only global teams can be chosen here. Add project teams after creation.</span>
              </div>
            </div>
          </section>

          <section className="new-ticket-block" aria-labelledby="project-modules-heading">
            <h2 id="project-modules-heading" className="form-section">Module catalog</h2>
            <p className="form-hint">
              Group pages under module names for ticket location fields on new tickets.
            </p>

            <ProjectModulesEditor
              value={moduleRows}
              onChange={setModuleRows}
            />
          </section>

          <div className="form-foot new-ticket-foot">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </button>
            <button type="button" className="btn" onClick={() => router.back()} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>

        <aside className="formside" aria-label="Project setup notes">
          <div className="panel">
            <header><h3>Company vs project</h3></header>
            <p className="note-line">
              A company groups related projects. One client might contain Web App and Mobile App as separate
              projects, each with its own module catalog and ticket defaults.
            </p>
          </div>

          <div className="panel">
            <header><h3>Ticket IDs</h3></header>
            <p className="note-line">
              Ticket IDs are assigned automatically from the project name. For example, Web App becomes WEB-1,
              WEB-2, and so on. The prefix cannot be changed later.
            </p>
          </div>

          <div className="panel">
            <header><h3>Project team and modules</h3></header>
            <p className="note-line">
              Assign a team now and set member roles after creation, or adjust them anytime on the Projects page.
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
        message="Complete the highlighted fields before creating this project."
        items={validationItems}
        onClose={closeValidationDialog}
      />
    </>
  );
}
