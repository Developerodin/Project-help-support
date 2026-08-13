'use client';

import { STAGES, PRIORITIES } from '@pms/shared';

export default function TicketFilters({ value, projects, onChange }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value, page: 1 });
  const toggle = (key) => {
    const next = value[key] ? undefined : true;
    onChange({ ...value, [key]: next, page: 1 });
  };

  return (
    <div className="toolbar">
      <input
        className="filterin"
        type="search"
        aria-label="Filter tickets"
        placeholder="Filter by number, title or module"
        value={value.q || ''}
        onChange={set('q')}
      />

      <select aria-label="Project" value={value.project || ''} onChange={set('project')}>
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <select aria-label="Stage" value={value.status || ''} onChange={set('status')}>
        <option value="">Any stage</option>
        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>

      <select aria-label="Priority" value={value.priority || ''} onChange={set('priority')}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <select aria-label="Scope" value={value.scope || 'all'} onChange={set('scope')}>
        <option value="all">Anyone</option>
        <option value="assigned">Assigned to me</option>
        <option value="reported">Reported by me</option>
        <option value="unassigned">Unassigned</option>
      </select>

      <button
        type="button"
        className={`btn btn-sm${value.blocked ? ' chip-on' : ''}`}
        aria-pressed={Boolean(value.blocked)}
        onClick={() => toggle('blocked')}
      >
        Blocked
      </button>
      <button
        type="button"
        className={`btn btn-sm${value.overdue ? ' chip-on' : ''}`}
        aria-pressed={Boolean(value.overdue)}
        onClick={() => toggle('overdue')}
      >
        Overdue
      </button>
      <button
        type="button"
        className={`btn btn-sm${value.reopened ? ' chip-on' : ''}`}
        aria-pressed={Boolean(value.reopened)}
        onClick={() => toggle('reopened')}
      >
        Reopened
      </button>
    </div>
  );
}
