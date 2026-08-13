'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORIES, PRIORITIES, SEVERITIES } from '@pms/shared';
import { createTicket } from '@/shared/api/tickets.js';
import { listProjects } from '@/shared/api/projects.js';
import { listTeams } from '@/shared/api/teams.js';
import { listUsers } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';

export default function NewTicketPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    project: '',
    title: '',
    description: '',
    module: '',
    page: '',
    category: 'bug',
    severity: 'major',
    priority: 'medium',
    assignedTo: '',
    team: '',
    estimatedResolutionAt: '',
    expectedReleaseDate: '',
  });

  useEffect(() => {
    Promise.all([
      listProjects(),
      listTeams(),
      listUsers({ status: 'active' }),
    ]).then(([p, t, u]) => {
      setProjects(p.results);
      setTeams(t.results);
      setUsers(u.results);
      if (p.results[0]) setDraft((d) => ({ ...d, project: p.results[0].id }));
    }).catch(setError);
  }, []);

  const selected = useMemo(
    () => projects.find((p) => p.id === draft.project),
    [projects, draft.project],
  );
  const modules = selected?.modules || [];
  const pages = modules.find((m) => m.label === draft.module)?.pages || [];

  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ticket = await createTicket({
        ...draft,
        assignedTo: draft.assignedTo || undefined,
        team: draft.team || undefined,
        module: draft.module || undefined,
        page: draft.page || undefined,
        estimatedResolutionAt: draft.estimatedResolutionAt || undefined,
        expectedReleaseDate: draft.expectedReleaseDate || undefined,
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
          <p className="sub">File something that is broken, unclear, or missing. It lands in Pending.</p>
        </div>
      </div>

      <FormError error={error} />

      <form className="form" id="newTicket" onSubmit={onSubmit}>
        <div className="form-cols">
          <div>
            <div className="form-row">
              <label htmlFor="np">Project</label>
              <select id="np" required value={draft.project} onChange={set('project')}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="nm">Module</label>
              <select id="nm" value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value, page: '' })}>
                <option value="">—</option>
                {modules.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="npage">Page</label>
              <select id="npage" value={draft.page} onChange={set('page')}>
                <option value="">—</option>
                {pages.map((p) => <option key={p.path || p.label} value={p.label}>{p.label}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor="nt">Title</label>
              <input id="nt" required placeholder="What goes wrong, in one line" value={draft.title} onChange={set('title')} />
            </div>

            <div className="form-row">
              <label htmlFor="nd">Steps / details</label>
              <textarea id="nd" rows={6} placeholder="1. Open the page&#10;2. Do the thing&#10;3. See what breaks" value={draft.description} onChange={set('description')} />
            </div>
          </div>

          <div className="formside">
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
              <label htmlFor="na">Assignee</label>
              <select id="na" value={draft.assignedTo} onChange={set('assignedTo')}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="ntm">Team</label>
              <select id="ntm" value={draft.team} onChange={set('team')}>
                <option value="">No team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="ne">Resolution estimate</label>
              <input id="ne" type="date" value={draft.estimatedResolutionAt} onChange={set('estimatedResolutionAt')} />
            </div>
            <div className="form-row">
              <label htmlFor="nr">Expected release</label>
              <input id="nr" type="date" value={draft.expectedReleaseDate} onChange={set('expectedReleaseDate')} />
            </div>
          </div>
        </div>

        <div className="form-foot">
          <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
          <span className="spacer" />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Filing…' : 'File ticket'}
          </button>
        </div>
      </form>
    </>
  );
}
