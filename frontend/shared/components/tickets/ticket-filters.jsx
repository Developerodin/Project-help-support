'use client';

import { STAGES, SEVERITIES, PRIORITIES, LABELS } from '@pms/shared';

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'reported', label: 'Reported by me' },
  { key: 'unassigned', label: 'Unassigned' },
];

export default function TicketFilters({ value, projects, onChange }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value, page: 1 });

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <div role="tablist" style={{ display: 'flex', gap: 4 }}>
        {SCOPES.map((scope) => (
          <button
            key={scope.key}
            type="button"
            role="tab"
            aria-selected={(value.scope || 'all') === scope.key}
            onClick={() => onChange({ ...value, scope: scope.key, page: 1 })}
          >
            {scope.label}
          </button>
        ))}
      </div>

      <input
        aria-label="Search"
        placeholder="Search title, description or WEB-101"
        value={value.q || ''}
        onChange={set('q')}
      />

      <select aria-label="Project" value={value.project || ''} onChange={set('project')}>
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {/* Stage options come from shared/stages.js — the filter and the pipeline
          cannot disagree about what a stage is called. */}
      <select aria-label="Stage" value={value.status || ''} onChange={set('status')}>
        <option value="">All stages</option>
        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>

      <select aria-label="Priority" value={value.priority || ''} onChange={set('priority')}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <select aria-label="Severity" value={value.severity || ''} onChange={set('severity')}>
        <option value="">Any severity</option>
        {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <select aria-label="Label" value={value.label || ''} onChange={set('label')}>
        <option value="">Any label</option>
        {LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
    </div>
  );
}
