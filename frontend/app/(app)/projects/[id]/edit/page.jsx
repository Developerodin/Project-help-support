'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { listUsers } from '@/shared/api/users.js';
import { listTeams } from '@/shared/api/teams.js';
import {
  getProject,
  getProjectClientTesters,
  patchProject,
  replaceModules,
  replaceProjectClientTesters,
} from '@/shared/api/projects.js';
import { ROLE_IDS } from '@pms/shared';
import CompanyLogo from '@/shared/components/companies/company-logo.jsx';
import FormError from '@/shared/components/form-error.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import ProjectTeamPanel from '@/shared/components/projects/project-team-panel.jsx';
import ExternalUserMultiSelect from '@/shared/components/external-user-multi-select.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import { formRowsToModules, modulesToFormRows } from '@/shared/lib/project-modules.js';
import { validateNewProjectDraft, EDIT_PROJECT_FIELD_IDS } from '@/shared/lib/validate-new-project.js';
import { showToast } from '@/shared/lib/toast.js';

function projectToDraft(project, testerIds = []) {
  return {
    clientId: project.client?.id ?? project.client ?? '',
    name: project.name || '',
    description: project.description || '',
    team: project.team?.id || project.team || '',
    clientTesterIds: testerIds,
  };
}

export default function EditProjectPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;

  const [project, setProject] = useState(null);
  const [draft, setDraft] = useState(null);
  const [moduleRows, setModuleRows] = useState([]);
  const [teams, setTeams] = useState([]);
  const [clientTesters, setClientTesters] = useState([]);
  const [companyWideIds, setCompanyWideIds] = useState([]);
  const [testersLoading, setTestersLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getProject(projectId),
      getProjectClientTesters(projectId).catch(() => ({ items: [] })),
      listTeams().catch(() => ({ results: [] })),
    ])
      .then(([loaded, testers, teamPage]) => {
        if (cancelled) return;
        const projectScopedIds = (testers.items || [])
          .filter((item) => item.scopeType === 'project')
          .map((item) => item.userId);
        const companyIds = (testers.items || [])
          .filter((item) => item.scopeType === 'company')
          .map((item) => item.userId);
        setProject(loaded);
        setDraft(projectToDraft(loaded, projectScopedIds));
        setModuleRows(modulesToFormRows(loaded.modules));
        setTeams(teamPage.results || []);
        setCompanyWideIds(companyIds);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectId]);

  const clientId = draft?.clientId;

  useEffect(() => {
    if (!clientId) {
      setClientTesters([]);
      setTestersLoading(false);
      return undefined;
    }

    let cancelled = false;
    setTestersLoading(true);
    listUsers({ role: ROLE_IDS.CLIENT_TESTER, status: 'active', limit: 100 })
      .then((page) => {
        if (!cancelled) setClientTesters(page.results || []);
      })
      .catch(() => {
        if (!cancelled) setClientTesters([]);
      })
      .finally(() => {
        if (!cancelled) setTestersLoading(false);
      });

    return () => { cancelled = true; };
  }, [clientId]);

  const selectedCompany = project?.client && typeof project.client === 'object'
    ? project.client
    : null;

  const nameLen = draft?.name.trim().length ?? 0;
  const descLen = draft?.description.trim().length ?? 0;
  const validation = useMemo(
    () => (draft
      ? validateNewProjectDraft(draft, EDIT_PROJECT_FIELD_IDS)
      : { valid: false, errors: [], liveMessage: '' }),
    [draft],
  );
  const nameInvalid = showValidation && validation.errors.some((e) => e.field === 'name');

  const displayTesterIds = useMemo(() => {
    const selected = draft?.clientTesterIds || [];
    return [...new Set([...selected, ...companyWideIds])];
  }, [draft?.clientTesterIds, companyWideIds]);

  const focusFirstInvalid = useCallback((result) => {
    const id = result?.firstFieldId;
    if (!id) return;
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  }, []);

  const set = (key) => (event) => {
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  };

  function goToProjects() {
    router.push('/projects');
  }

  function closeValidationDialog() {
    setValidationDialogOpen(false);
    focusFirstInvalid(validateNewProjectDraft(draft, EDIT_PROJECT_FIELD_IDS));
  }

  function onTesterChange(nextIds) {
    const locked = new Set(companyWideIds);
    setDraft((prev) => ({
      ...prev,
      clientTesterIds: nextIds.filter((id) => !locked.has(id)),
    }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    const result = validateNewProjectDraft(draft, EDIT_PROJECT_FIELD_IDS);
    if (!result.valid) {
      setValidationItems(result.summaryItems);
      setValidationDialogOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await patchProject(projectId, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        team: draft.team || null,
      });
      await replaceProjectClientTesters(projectId, draft.clientTesterIds);
      await replaceModules(projectId, formRowsToModules(moduleRows));
      showToast(`${project.key} updated`);
      router.push('/projects');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-skeleton" aria-busy="true">
        <AppLoader inline label="Loading project…" ariaLabel="Loading project" />
      </div>
    );
  }

  if (!project || !draft) {
    return (
      <>
        <nav className="crumb" aria-label="Breadcrumb">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Edit</span>
        </nav>
        <div className="page-head">
          <div>
            <h1>Edit project</h1>
            <p className="sub">This project could not be loaded.</p>
          </div>
        </div>
        <FormError error={error} />
        <button type="button" className="btn" onClick={goToProjects}>
          Back to projects
        </button>
      </>
    );
  }

  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb">
        <Link href="/projects">Projects</Link>
        <span aria-hidden="true">/</span>
        <span>{project.key}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Edit</span>
      </nav>

      <div className="page-head">
        <div>
          <h1>Edit project</h1>
          <p className="sub">
            Update {project.key} — {project.name}. Company and project key stay as they are.
          </p>
        </div>
      </div>

      <FormError error={error} />

      <div className="formgrid new-ticket-grid">
        <form className="form new-ticket-form new-project-form" id="editProject" onSubmit={onSubmit} noValidate>
          <section className="new-ticket-block" aria-labelledby="project-details-heading">
            <h2 id="project-details-heading" className="form-section">Project details</h2>
            <p className="form-hint">Company, project name, and optional description.</p>

            <div className="form-row">
              <span className="lbl" id="epc-label">Company</span>
              {selectedCompany ? (
                <div className="company-select-preview" aria-labelledby="epc-label">
                  <CompanyLogo company={selectedCompany} size={24} />
                  <span>{selectedCompany.name}</span>
                </div>
              ) : (
                <p className="field-hint">Company is set and cannot be changed.</p>
              )}
              <p id="epc-hint" className="field-hint">
                Projects always belong to one company. This cannot be changed after creation.
              </p>
            </div>

            <div className="form-row">
              <label htmlFor="epk">Project key</label>
              <input
                id="epk"
                value={project.key}
                readOnly
                aria-readonly="true"
                aria-describedby="epk-hint"
              />
              <p id="epk-hint" className="field-hint">
                Ticket IDs use this prefix. It cannot be changed.
              </p>
            </div>

            <div className={`form-row${nameInvalid ? ' bad' : ''}`}>
              <label htmlFor="epn">Project <span className="req" aria-hidden="true">*</span></label>
              <input
                id="epn"
                required
                maxLength={120}
                placeholder="e.g. Web App"
                value={draft.name}
                onChange={set('name')}
                aria-invalid={nameInvalid}
                aria-describedby="epn-hint"
              />
              <p id="epn-hint" className={`field-hint${nameInvalid ? ' invalid' : ''}`}>
                {nameInvalid ? 'Required.' : `${nameLen}/120 characters`}
              </p>
              <span className="help">The product or app under this company.</span>
            </div>

            <div className="form-row">
              <label htmlFor="epd">Description</label>
              <textarea
                id="epd"
                rows={3}
                maxLength={1000}
                placeholder="Optional - what this project covers"
                value={draft.description}
                onChange={set('description')}
                aria-describedby="epd-hint"
              />
              <p id="epd-hint" className="field-hint">
                {descLen > 0 ? `${descLen}/1000 characters` : 'Optional'}
              </p>
            </div>
          </section>

          <section className="new-ticket-block" aria-labelledby="project-team-heading">
            <h2 id="project-team-heading" className="form-section">Project team</h2>
            <p className="form-hint">
              Assign one team to this project. Member roles come from each person&apos;s profile.
            </p>

            <ProjectTeamPanel
              project={project}
              teams={teams}
              teamId={draft.team}
              onTeamChange={(team) => setDraft((prev) => ({ ...prev, team }))}
              disabled={busy}
            />
          </section>

          <section className="new-ticket-block" aria-labelledby="project-client-testers-heading">
            <h2 id="project-client-testers-heading" className="form-section">Client tester assign</h2>

            <ExternalUserMultiSelect
              label="Client tester assign"
              hideLabel
              ariaLabelledBy="project-client-testers-heading"
              users={clientTesters}
              selectedIds={displayTesterIds}
              onChange={onTesterChange}
              disabled={busy}
              loading={testersLoading}
              lockedIds={companyWideIds}
              emptyMessage="No client testers available. Invite users from People."
            />
          </section>

          <section className="new-ticket-block" aria-labelledby="project-modules-heading">
            <h2 id="project-modules-heading" className="form-section">Module catalog</h2>
            <p className="form-hint">
              Group pages under module names for ticket location fields on new tickets.
            </p>

            <ProjectModulesEditor
              projectKey={project.key}
              value={moduleRows}
              onChange={setModuleRows}
            />
          </section>

          <div className="form-foot new-ticket-foot">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="btn" onClick={goToProjects} disabled={busy}>
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
              Ticket IDs keep the existing prefix for this project. The prefix cannot be changed.
            </p>
          </div>

          <div className="panel">
            <header><h3>Project team and modules</h3></header>
            <p className="note-line">
              Assign a team and keep the module catalog in one place. Member roles come from each
              person&apos;s profile, not from this page.
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
            overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
          }}
        >
          {validation.liveMessage}
        </div>
      ) : null}

      <ValidationDialog
        open={validationDialogOpen}
        title="Fill in required fields"
        message="Complete the highlighted fields before saving this project."
        items={validationItems}
        onClose={closeValidationDialog}
      />
    </>
  );
}
