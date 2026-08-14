'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, listBrands } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
import { listTeams } from '@/shared/api/teams.js';
import FormError from '@/shared/components/form-error.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import { formRowsToModules } from '@/shared/lib/project-modules.js';
import { validateNewProjectDraft } from '@/shared/lib/validate-new-project.js';
import { showToast } from '@/shared/lib/toast.js';

const INITIAL_DRAFT = {
  brand: '',
  name: '',
  description: '',
  defaultAssignee: '',
  defaultTester: '',
  defaultTeam: '',
};

export default function NewProjectPage() {
  const router = useRouter();
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const [moduleRows, setModuleRows] = useState([]);
  const [brands, setBrands] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);

  useEffect(() => {
    listBrands().then(setBrands).catch(() => {});
    listUsers({ status: 'active' }).then((p) => setUsers(p.results)).catch(() => {});
    listTeams().then((p) => setTeams(p.results)).catch(() => {});
  }, []);

  const brandLen = draft.brand.trim().length;
  const nameLen = draft.name.trim().length;
  const descLen = draft.description.trim().length;
  const validation = useMemo(() => validateNewProjectDraft(draft), [draft]);
  const brandInvalid = showValidation && validation.errors.some((e) => e.field === 'brand');
  const nameInvalid = showValidation && validation.errors.some((e) => e.field === 'name');
  const brandError = validation.errors.find((e) => e.field === 'brand');

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
        brand: draft.brand.trim(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        defaultAssignee: draft.defaultAssignee || null,
        defaultTester: draft.defaultTester || null,
        defaultTeam: draft.defaultTeam || null,
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
          <p className="sub">Add a project under a brand with defaults and a module catalog.</p>
        </div>
      </div>

      <FormError error={error} />

      <div className="formgrid new-ticket-grid">
        <form className="form new-ticket-form new-project-form" id="newProject" onSubmit={onSubmit} noValidate>
          <section className="new-ticket-block" aria-labelledby="project-details-heading">
            <h2 id="project-details-heading" className="form-section">Project details</h2>
            <p className="form-hint">Brand, project name, and optional description.</p>

            <div className={`form-row${brandInvalid ? ' bad' : ''}`}>
              <label htmlFor="npb">Brand <span className="req" aria-hidden="true">*</span></label>
              <input
                id="npb"
                required
                list="brand-options"
                maxLength={80}
                placeholder="e.g. Dharwin"
                value={draft.brand}
                onChange={set('brand')}
                aria-invalid={brandInvalid}
                aria-describedby="npb-hint"
              />
              <datalist id="brand-options">
                {brands.map((brand) => <option key={brand} value={brand} />)}
              </datalist>
              <p id="npb-hint" className={`field-hint${brandInvalid ? ' invalid' : ''}`}>
                {brandInvalid
                  ? (brandError?.message ?? 'Invalid brand.')
                  : `${brandLen}/80 · company or product line`}
              </p>
              <span className="help">Pick an existing brand or type a new one. Projects nest under brands.</span>
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
              <span className="help">The product or app under this brand.</span>
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

          <section className="new-ticket-block" aria-labelledby="project-defaults-heading">
            <h2 id="project-defaults-heading" className="form-section">Defaults</h2>
            <p className="form-hint">
              Pre-fill lead, tester, and team when someone files a ticket in this project.
            </p>

            <div className="new-project-defaults-stack">
              <div className="form-row">
                <label htmlFor="npda">Default lead</label>
                <select
                  id="npda"
                  value={draft.defaultAssignee}
                  onChange={set('defaultAssignee')}
                >
                  <option value="">None</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div className="form-row">
                <label htmlFor="npdt">Default tester</label>
                <select
                  id="npdt"
                  value={draft.defaultTester}
                  onChange={set('defaultTester')}
                >
                  <option value="">None</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div className="form-row">
                <label htmlFor="npdteam">Default team</label>
                <select
                  id="npdteam"
                  value={draft.defaultTeam}
                  onChange={set('defaultTeam')}
                >
                  <option value="">None</option>
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
            <header><h3>Brand vs project</h3></header>
            <p className="note-line">
              A brand groups related projects. Dharwin might contain Web App and Mobile App as separate
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
            <header><h3>Defaults and modules</h3></header>
            <p className="note-line">
              Set lead, tester, team, and module catalog now, or adjust them anytime on the Projects page.
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
