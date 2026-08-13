'use client';

import { useEffect, useRef } from 'react';
import { STAGES, PRIORITIES } from '@pms/shared';
import {
  FOCUS_TICKET_SEARCH_KEY,
  TICKET_SEARCH_INPUT_ID,
  focusTicketSearch,
} from '@/shared/lib/ticket-search-focus.js';

export default function TicketFilters({ value, onChange }) {
  const searchRef = useRef(null);
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value, page: 1 });
  const toggle = (key) => {
    const next = value[key] ? undefined : true;
    onChange({ ...value, [key]: next, page: 1 });
  };

  useEffect(() => {
    let shouldFocus = false;
    try { shouldFocus = sessionStorage.getItem(FOCUS_TICKET_SEARCH_KEY) === '1'; } catch { /* ignore */ }
    if (shouldFocus) {
      try { sessionStorage.removeItem(FOCUS_TICKET_SEARCH_KEY); } catch { /* ignore */ }
      focusTicketSearch();
    }
  }, []);

  return (
    <div className="toolbar">
      <input
        ref={searchRef}
        id={TICKET_SEARCH_INPUT_ID}
        className="filterin"
        type="search"
        aria-label="Filter tickets"
        placeholder="Filter by number, title or module"
        value={value.q || ''}
        onChange={set('q')}
      />

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
