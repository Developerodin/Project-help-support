'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CATEGORIES, ENVIRONMENTS, LABELS, PRIORITIES, SEVERITIES,
} from '@pms/shared';
import { createTicket } from '@/shared/api/tickets.js';
import { listProjects } from '@/shared/api/projects.js';
import FormError from '@/shared/components/form-error.jsx';

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
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [draft, setDraft] = useState(INITIAL_DRAFT);

  useEffect(() => {
    listProjects()
      .then((p) => {
        const active = p.results.filter((proj) => proj.status === 'active');
        setProjects(active);
        if (active[0]) setDraft((d) => ({ ...d, project: active[0].id }));
      })
      .catch(setError);
  }, []);

  const selected = useMemo(
    () => projects.find((p) => p.id === draft.project),
    [projects, draft.project],
  );
  const modules = selected?.modules || [];
  const pages = modules.find((m) => m.label === draft.module)?.pages || [];

  const titleLen = draft.title.trim().length;
  const descLen = draft.description.trim().length;
  const titleInvalid = showValidation && titleLen < 5;
  const descInvalid = showValidation && descLen < 10;

  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });

  const toggleLabel = (label) => {
    setDraft((d) => ({
      ...d,
      labels: d.labels.includes(label)
        ? d.labels.filter((l) => l !== label)
        : [...d.labels, label],
    }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    setShowValidation(true);
    if (titleLen < 5 || descLen < 10) return;

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
          <p className="sub">Report a bug or request. Required fields are marked. Estimates and assignment are set later.</p>
        </div>
      </div>

      <FormError error={error} />

      <form className="form" id="newTicket" onSubmit={onSubmit}>
        <div className="form-cols">
          <div>
            <h2 className="form-section">Issue</h2>
            <p className="form-hint">What broke, and how to reproduce it.</p>

            <div className="form-row">
              <label htmlFor="np">Project <span className="req">*</span></label>
              <select id="np" required value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value, module: '', page: '' })}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="nt">Title <span className="req">*</span></label>
              <input
                id="nt"
                required
                maxLength={200}
                placeholder="Short summary of the issue"
                value={draft.title}
                onChange={set('title')}
                aria-invalid={titleInvalid}
              />
              <p className={`field-hint${titleInvalid ? ' invalid' : ''}`}>
                {titleInvalid ? 'At least 5 characters required.' : `${titleLen}/200 · min 5 characters`}
              </p>
            </div>

            <div className="form-row">
              <label htmlFor="nd">Description <span className="req">*</span></label>
              <textarea
                id="nd"
                rows={4}
                required
                placeholder="Expected behavior, actual behavior, and any error messages"
                value={draft.description}
                onChange={set('description')}
                aria-invalid={descInvalid}
              />
              <p className={`field-hint${descInvalid ? ' invalid' : ''}`}>
                {descInvalid ? 'At least 10 characters required.' : `${descLen} characters · min 10`}
              </p>
            </div>

            <div className="form-row">
              <label htmlFor="ns">Steps to reproduce</label>
              <textarea
                id="ns"
                rows={3}
                placeholder="1. Go to…&#10;2. Click…&#10;3. See error"
                value={draft.stepsToReproduce}
                onChange={set('stepsToReproduce')}
              />
            </div>

            <h2 className="form-section">Location</h2>
            <p className="form-hint">Where in the product this occurred.</p>

            <div className="form-row">
              <label htmlFor="nm">Module</label>
              <select id="nm" value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value, page: '' })}>
                <option value="">—</option>
                {modules.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="npage">Page</label>
              <select id="npage" value={draft.page} onChange={set('page')} disabled={!draft.module}>
                <option value="">—</option>
                {pages.map((p) => <option key={p.path || p.label} value={p.label}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div className="formside">
            <h2 className="form-section">Classification</h2>

            <div className="form-row">
              <label htmlFor="ncat">Category</label>
              <select id="ncat" value={draft.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="nsev">Severity</label>
              <select id="nsev" value={draft.severity} onChange={set('severity')}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="npri">Priority</label>
              <select id="npri" value={draft.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="nenv">Environment</label>
              <select id="nenv" value={draft.environment} onChange={set('environment')}>
                {ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>

            <div className="form-row">
              <span className="lbl">Labels</span>
              <div className="label-chips" role="group" aria-label="Ticket labels">
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

        <div className="form-foot">
          <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
          <span className="spacer" />
          <button type="submit" className="btn btn-primary" disabled={busy || titleLen < 5 || descLen < 10}>
            {busy ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </>
  );
}
