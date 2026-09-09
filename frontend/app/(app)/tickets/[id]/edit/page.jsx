'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  CATEGORIES, ENVIRONMENTS, LABELS, PRIORITIES, SEVERITIES,
  resolveProjectModules,
} from '@pms/shared';
import { getTicket, patchTicket } from '@/shared/api/tickets.js';
import FormError from '@/shared/components/form-error.jsx';
import ValidationDialog from '@/shared/components/validation-dialog.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import {
  defaultPageForModule,
  pagesForModule,
} from '@/shared/lib/ticket-location.js';
import { validateTicketEditDraft } from '@/shared/lib/validate-new-ticket.js';

function ticketToDraft(ticket) {
  return {
    title: ticket.title || '',
    description: ticket.description || '',
    stepsToReproduce: ticket.stepsToReproduce || '',
    module: ticket.module || '',
    page: ticket.page || '',
    category: ticket.category || 'Bug',
    severity: ticket.severity || 'Major',
    priority: ticket.priority || 'Medium',
    environment: ticket.environment || 'Staging',
    labels: ticket.labels || [],
  };
}

export default function EditTicketPage() {
  const router = useRouter();
  const params = useParams();
  const ticketId = params.id;

  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationItems, setValidationItems] = useState([]);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    getTicket(ticketId)
      .then((loaded) => {
        setTicket(loaded);
        setDraft(ticketToDraft(loaded));
      })
      .catch(setError);
  }, [ticketId]);

  const modules = useMemo(
    () => resolveProjectModules(ticket?.project),
    [ticket?.project],
  );
  const pages = pagesForModule(modules, draft?.module);
  const hasModules = modules.length > 0;
  const projectName = ticket?.project?.name || ticket?.project?.key || ticket?.projectKey;

  const titleLen = draft?.title.trim().length ?? 0;
  const descLen = draft?.description.trim().length ?? 0;
  const validation = useMemo(
    () => (draft ? validateTicketEditDraft(draft) : { valid: false }),
    [draft],
  );
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

  function closeValidationDialog() {
    setValidationDialogOpen(false);
    focusFirstInvalid(validateTicketEditDraft(draft));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!ticket || !draft) return;

    setShowValidation(true);
    const result = validateTicketEditDraft(draft);
    if (!result.valid) {
      setValidationItems(result.summaryItems);
      setValidationDialogOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await patchTicket(ticket.ticketId, {
        revision: ticket.revision,
        title: draft.title.trim(),
        description: draft.description.trim(),
        stepsToReproduce: draft.stepsToReproduce.trim() || null,
        module: draft.module || null,
        page: draft.page || null,
        category: draft.category,
        severity: draft.severity,
        priority: draft.priority,
        environment: draft.environment,
        labels: draft.labels,
      });
      router.push(`/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!ticket || !draft) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Edit ticket</h1>
          </div>
        </div>
        <FormError error={error} />
        {!error && <AppLoader inline />}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Edit {ticket.ticketId}</h1>
          <p className="sub">Update issue details. Stage changes stay in the ticket drawer.</p>
        </div>
      </div>

      <FormError error={error} />

      <div className="formgrid new-ticket-grid">
        <form className="form new-ticket-form" id="editTicket" onSubmit={onSubmit} noValidate>
          <section className="new-ticket-block" aria-labelledby="issue-heading">
            <h2 id="issue-heading" className="form-section">Issue</h2>
            <p className="form-hint">What broke, and how to reproduce it.</p>

            <div className="form-row">
              <span className="lbl">Project</span>
              <p className="v">{projectName || '—'}</p>
              <p className="field-hint">Project cannot be changed after filing.</p>
            </div>

            <div className={`form-row${titleInvalid ? ' bad' : ''}`}>
              <label htmlFor="et">Title <span className="req" aria-hidden="true">*</span></label>
              <input
                id="et"
                required
                maxLength={200}
                placeholder="What goes wrong, in one line"
                value={draft.title}
                onChange={set('title')}
                aria-invalid={titleInvalid}
                aria-describedby="et-hint"
              />
              <p id="et-hint" className={`field-hint${titleInvalid ? ' invalid' : ''}`}>
                {titleInvalid
                  ? (titleLen === 0 ? 'Required.' : 'At least 5 characters required.')
                  : `${titleLen}/200 · min 5 characters`}
              </p>
            </div>

            <div className={`form-row${descInvalid ? ' bad' : ''}`}>
              <label htmlFor="ed">Description <span className="req" aria-hidden="true">*</span></label>
              <textarea
                id="ed"
                rows={4}
                required
                placeholder="Expected behavior, actual behavior, and any error messages"
                value={draft.description}
                onChange={set('description')}
                aria-invalid={descInvalid}
                aria-describedby="ed-hint"
              />
              <p id="ed-hint" className={`field-hint${descInvalid ? ' invalid' : ''}`}>
                {descInvalid
                  ? (descLen === 0 ? 'Required.' : 'At least 10 characters required.')
                  : `${descLen} characters · min 10`}
              </p>
            </div>

            <div className="form-row">
              <label htmlFor="es">Steps to reproduce</label>
              <textarea
                id="es"
                rows={3}
                placeholder={'1. Go to…\n2. Click…\n3. See error'}
                value={draft.stepsToReproduce}
                onChange={set('stepsToReproduce')}
              />
            </div>
          </section>

          <section className="new-ticket-block" aria-labelledby="location-heading">
            <h2 id="location-heading" className="form-section">Location</h2>
            <p className="form-hint">Where in the product this occurred.</p>

            <div className="form-cols">
              <div className="form-row">
                <label htmlFor="em">Module</label>
                <select
                  id="em"
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
                >
                  {!hasModules ? (
                    <option value="">Add module</option>
                  ) : (
                    modules.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)
                  )}
                </select>
                {!hasModules ? (
                  <span className="help">
                    <Link href="/projects">Configure in Projects →</Link>
                  </span>
                ) : null}
              </div>

              <div className="form-row">
                <label htmlFor="epage">Page</label>
                <select
                  id="epage"
                  className="new-ticket-select"
                  value={draft.page}
                  onChange={set('page')}
                  disabled={!draft.module || pages.length === 0}
                >
                  {!draft.module ? (
                    <option value="">Choose a module first</option>
                  ) : pages.length === 0 ? (
                    <option value="">No pages</option>
                  ) : (
                    pages.map((p, index) => (
                      <option key={`${p.label}:${p.path || index}`} value={p.label}>{p.label}</option>
                    ))
                  )}
                </select>
              </div>
            </div>
          </section>

          <div className="form-foot new-ticket-foot">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => router.push(`/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>

        <aside className="formside" aria-label="Classification">
          <div className="panel">
            <header><h3>Classification</h3></header>
            <p className="note-line">How severe it is and how soon it should be looked at.</p>

            <div className="formside-stack">
              <div className="form-row">
                <label htmlFor="ecat">Category</label>
                <select id="ecat" form="editTicket" value={draft.category} onChange={set('category')}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="form-cols">
                <div className="form-row">
                  <label htmlFor="esev">Severity</label>
                  <select id="esev" form="editTicket" value={draft.severity} onChange={set('severity')}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="form-row">
                  <label htmlFor="epri">Priority</label>
                  <select id="epri" form="editTicket" value={draft.priority} onChange={set('priority')}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="eenv">Environment</label>
                <select id="eenv" form="editTicket" value={draft.environment} onChange={set('environment')}>
                  {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>

              <div className="form-row">
                <span className="lbl" id="edit-labels-label">Labels</span>
                <div className="label-chips" role="group" aria-labelledby="edit-labels-label">
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
    </>
  );
}
