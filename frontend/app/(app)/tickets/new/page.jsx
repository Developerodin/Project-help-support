'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CATEGORIES, ENVIRONMENTS, LABELS, PRIORITIES, SEVERITIES,
  resolveProjectModules,
} from '@pms/shared';
import { createTicket, uploadAttachments } from '@/shared/api/tickets.js';
import { listProjects } from '@/shared/api/projects.js';
import { useProject } from '@/shared/contexts/project-context.jsx';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import AttachmentPicker from '@/shared/components/attachment-picker.jsx';
import AttachmentUploadLoader from '@/shared/components/attachment-upload-loader.jsx';
import {
  defaultModulePageSelection,
  defaultPageForModule,
  pagesForModule,
} from '@/shared/lib/ticket-location.js';
import { validateNewTicketDraft } from '@/shared/lib/validate-new-ticket.js';
import {
  buildAttachmentFormData,
  validateAttachmentBatch,
} from '@/shared/lib/attachment-config.js';

const INITIAL_DRAFT = {
  project: '',
  title: '',
  description: '',
  stepsToReproduce: '',
  module: '',
  page: '',
  category: 'Bug',
  severity: 'Major',
  priority: 'Medium',
  environment: 'Staging',
  labels: [],
};

export default function NewTicketPage() {
  const router = useRouter();
  const { activeProjectId } = useProject();
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const [attachments, setAttachments] = useState([]);
  const [attachmentErrors, setAttachmentErrors] = useState([]);

  useEffect(() => {
    listProjects()
      .then((p) => {
        const active = p.results.filter((proj) => proj.status === 'active');
        setProjects(active);
        const preferred = activeProjectId && active.some((proj) => proj.id === activeProjectId)
          ? activeProjectId
          : (active.find((proj) => proj.key === 'WEB') ?? active[0])?.id;
        if (preferred) setDraft((d) => ({ ...d, project: preferred }));
      })
      .catch(setError);
  }, [activeProjectId]);

  const selected = useMemo(
    () => projects.find((p) => p.id === draft.project),
    [projects, draft.project],
  );
  const modules = resolveProjectModules(selected);
  const pages = pagesForModule(modules, draft.module);
  const hasModules = modules.length > 0;

  useEffect(() => {
    if (!selected) return;
    const { module, page } = defaultModulePageSelection(modules);
    setDraft((d) => {
      if (!modules.length) {
        if (!d.module && !d.page) return d;
        return { ...d, module: '', page: '' };
      }
      const moduleValid = modules.some((m) => m.label === d.module);
      if (!moduleValid) return { ...d, module, page };
      const pageValid = pagesForModule(modules, d.module).some((p) => p.label === d.page);
      if (!pageValid) return { ...d, page: defaultPageForModule(modules, d.module) };
      return d;
    });
  }, [selected?.id, modules]);

  const titleLen = draft.title.trim().length;
  const descLen = draft.description.trim().length;
  const validation = useMemo(() => validateNewTicketDraft(draft), [draft]);
  const projectInvalid = showValidation && !draft.project;
  const titleInvalid = showValidation && titleLen < 5;
  const descInvalid = showValidation && descLen < 10;

  const focusFirstInvalid = useCallback((result) => {
    const id = result?.firstFieldId;
    if (!id) return;
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  }, []);

  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });

  const toggleLabel = (label) => {
    setDraft((d) => ({
      ...d,
      labels: d.labels.includes(label)
        ? d.labels.filter((l) => l !== label)
        : [...d.labels, label],
    }));
  };

  const addFiles = useCallback((files) => {
    setAttachments((prev) => {
      const { errors, valid } = validateAttachmentBatch(prev, files);
      setAttachmentErrors(errors);
      return valid.length ? [...prev, ...valid] : prev;
    });
  }, []);

  function closeValidationDialog() {
    setValidationDialogOpen(false);
    focusFirstInvalid(validateNewTicketDraft(draft));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    const result = validateNewTicketDraft(draft);
    if (!result.valid) {
      setValidationItems(result.summaryItems);
      setValidationDialogOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const ticket = await createTicket({
        project: draft.project,
        title: draft.title.trim(),
        description: draft.description.trim(),
        stepsToReproduce: draft.stepsToReproduce.trim() || undefined,
        module: draft.module || undefined,
        page: draft.page || undefined,
        category: draft.category,
        severity: draft.severity,
        priority: draft.priority,
        environment: draft.environment,
        labels: draft.labels,
      });

      if (attachments.length > 0) {
        setUploadingAttachments(true);
        try {
          await uploadAttachments(ticket.ticketId, buildAttachmentFormData(attachments));
        } catch {
          // Ticket exists; attachments remain optional and can be added from the drawer.
        } finally {
          setUploadingAttachments(false);
        }
      }

      router.push(`/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`);
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
          <h1>New ticket</h1>
          <p className="sub">It lands in Pending. A lead or an admin picks it up from there.</p>
        </div>
      </div>

      <FormError error={error} />

      <div className="formgrid new-ticket-grid">
        <form className="form new-ticket-form" id="newTicket" onSubmit={onSubmit} noValidate>

          <section className="new-ticket-block" aria-labelledby="issue-heading">
            <h2 id="issue-heading" className="form-section">Issue</h2>
            <p className="form-hint">What broke, and how to reproduce it.</p>

            <div className={`form-row${projectInvalid ? ' bad' : ''}`}>
              <label htmlFor="np">Project <span className="req" aria-hidden="true">*</span></label>
              <select
                id="np"
                required
                value={draft.project}
                aria-invalid={projectInvalid}
                aria-describedby="np-hint"
                onChange={(e) => {
                  const projectId = e.target.value;
                  const project = projects.find((p) => p.id === projectId);
                  const mods = resolveProjectModules(project);
                  const { module, page } = defaultModulePageSelection(mods);
                  setDraft({ ...draft, project: projectId, module, page });
                }}
              >
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p id="np-hint" className={`field-hint${projectInvalid ? ' invalid' : ''}`}>
                {projectInvalid ? 'Select a project.' : 'Required'}
              </p>
            </div>

            <div className={`form-row${titleInvalid ? ' bad' : ''}`}>
              <label htmlFor="nt">Title <span className="req" aria-hidden="true">*</span></label>
              <input
                id="nt"
                required
                maxLength={200}
                placeholder="What goes wrong, in one line"
                value={draft.title}
                onChange={set('title')}
                aria-invalid={titleInvalid}
                aria-describedby="nt-hint"
              />
              <p id="nt-hint" className={`field-hint${titleInvalid ? ' invalid' : ''}`}>
                {titleInvalid
                  ? (titleLen === 0 ? 'Required.' : 'At least 5 characters required.')
                  : `${titleLen}/200 · min 5 characters`}
              </p>
              <span className="help">Write what happens, not what you expected.</span>
            </div>

            <div className={`form-row${descInvalid ? ' bad' : ''}`}>
              <label htmlFor="nd">Description <span className="req" aria-hidden="true">*</span></label>
              <textarea
                id="nd"
                rows={4}
                required
                placeholder="Expected behavior, actual behavior, and any error messages"
                value={draft.description}
                onChange={set('description')}
                aria-invalid={descInvalid}
                aria-describedby="nd-hint"
              />
              <p id="nd-hint" className={`field-hint${descInvalid ? ' invalid' : ''}`}>
                {descInvalid
                  ? (descLen === 0 ? 'Required.' : 'At least 10 characters required.')
                  : `${descLen} characters · min 10`}
              </p>
            </div>

            <div className="form-row">
              <label htmlFor="ns">Steps to reproduce</label>
              <textarea
                id="ns"
                rows={3}
                placeholder={'1. Go to…\n2. Click…\n3. See error'}
                value={draft.stepsToReproduce}
                onChange={set('stepsToReproduce')}
              />
            </div>

            <AttachmentPicker
              files={attachments}
              onChange={setAttachments}
              onAddFiles={addFiles}
              errors={attachmentErrors}
              disabled={busy}
              idPrefix="new-ticket-attach"
            />
          </section>

          <section className="new-ticket-block" aria-labelledby="location-heading">
            <h2 id="location-heading" className="form-section">Location</h2>
            <p className="form-hint">Where in the product this occurred.</p>

            <div className="form-cols">
              <div className="form-row">
                <label htmlFor="nm">Module</label>
                <select
                  id="nm"
                  className="new-ticket-select"
                  value={draft.module}
                  disabled={!hasModules}
                  onChange={(e) => {
                    const module = e.target.value;
                    setDraft({
                      ...draft,
                      module,
                      page: defaultPageForModule(modules, module),
                    });
                  }}
                  aria-describedby={!hasModules ? 'nm-hint' : undefined}
                >
                  {!hasModules ? (
                    <option value="">Add module</option>
                  ) : (
                    modules.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)
                  )}
                </select>
                {!hasModules ? (
                  <span id="nm-hint" className="help">
                    <Link href="/projects">Configure in Projects →</Link>
                  </span>
                ) : null}
              </div>

              <div className="form-row">
                <label htmlFor="npage">Page</label>
                <select
                  id="npage"
                  className="new-ticket-select"
                  value={draft.page}
                  onChange={set('page')}
                  disabled={!draft.module || pages.length === 0}
                  aria-describedby={
                    !hasModules ? 'nm-hint'
                      : !draft.module ? 'npage-hint'
                        : pages.length === 0 ? 'npage-empty-hint'
                          : undefined
                  }
                >
                  {!draft.module ? (
                    <option value="">Choose a module first</option>
                  ) : pages.length === 0 ? (
                    <option value="">No pages</option>
                  ) : (
                    pages.map((p) => <option key={p.path || p.label} value={p.label}>{p.label}</option>)
                  )}
                </select>
                {!hasModules ? null : !draft.module ? (
                  <span id="npage-hint" className="help">Choose a module first.</span>
                ) : pages.length === 0 ? (
                  <span id="npage-empty-hint" className="help">This module has no pages yet.</span>
                ) : null}
              </div>
            </div>
          </section>

          <div className="form-foot new-ticket-foot">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {uploadingAttachments ? 'Uploading…' : busy ? 'Creating…' : 'File ticket'}
            </button>
            <button type="button" className="btn" onClick={() => router.back()} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>

        <aside className="formside" aria-label="Classification and routing">
          <div className="panel">
            <header><h3>Classification</h3></header>
            <p className="note-line">How severe it is and how soon it should be looked at.</p>

            <div className="formside-stack">
              <div className="form-row">
                <label htmlFor="ncat">Category</label>
                <select id="ncat" form="newTicket" value={draft.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="form-cols">
                <div className="form-row">
                  <label htmlFor="nsev">Severity</label>
                  <select id="nsev" form="newTicket" value={draft.severity} onChange={set('severity')}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="help">How badly it breaks the product.</span>
                </div>

                <div className="form-row">
                  <label htmlFor="npri">Priority</label>
                  <select id="npri" form="newTicket" value={draft.priority} onChange={set('priority')}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <span className="help">How soon it should be looked at.</span>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="nenv">Environment</label>
                <select id="nenv" form="newTicket" value={draft.environment} onChange={set('environment')}>
                  {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>

              <div className="form-row">
                <span className="lbl" id="labels-label">Labels</span>
                <div className="label-chips" role="group" aria-labelledby="labels-label">
                  {LABELS.map((lbl) => {
                    const sel = draft.labels.includes(lbl);
                    return (
                      <button
                        key={lbl}
                        type="button"
                        aria-pressed={sel}
                        className={`chip${sel ? ' chip-on' : ''}`}
                        onClick={() => toggleLabel(lbl)}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <header><h3>Where it lands</h3></header>
            <p className="note-line">
              Every new ticket starts in Pending. A lead moves it on from there, and the rest of the
              pipeline unlocks as the ticket earns it.
            </p>
            <p className="meta">Estimates and assignment are set later.</p>
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
        items={validationItems}
        onClose={closeValidationDialog}
      />

      {uploadingAttachments ? (
        <div className="attach-upload-overlay">
          <AttachmentUploadLoader variant="overlay" label="Uploading…" />
        </div>
      ) : null}
    </>
  );
}
