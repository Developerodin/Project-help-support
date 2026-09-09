'use client';

import { useEffect, useRef } from 'react';
import { STAGES, PRIORITIES, CATEGORIES, SEVERITIES } from '@pms/shared';
import {
  FOCUS_TICKET_SEARCH_KEY,
  TICKET_SEARCH_INPUT_ID,
  focusTicketSearch,
} from '@/shared/lib/ticket-search-focus.js';

export default function TicketFilters({
  filters,
  onChange,
  searchValue,
  onSearchChange,
  ownerOptions = [],
  ownerScopeHint = null,
  onReset,
  resetBusy = false,
  showReset = false,
}) {
  const searchRef = useRef(null);
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  const toggle = (key) => {
    const next = filters[key] ? false : true;
    onChange({ ...filters, [key]: next });
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
        value={searchValue ?? filters.q ?? ''}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <select aria-label="Stage" value={filters.status || ''} onChange={set('status')}>
        <option value="">Any stage</option>
        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>

      <select aria-label="Priority" value={filters.priority || ''} onChange={set('priority')}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <select aria-label="Category" value={filters.category || ''} onChange={set('category')}>
        <option value="">Any category</option>
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>{category}</option>
        ))}
      </select>

      <select aria-label="Severity" value={filters.severity || ''} onChange={set('severity')}>
        <option value="">Any severity</option>
        {SEVERITIES.map((severity) => (
          <option key={severity} value={severity}>{severity}</option>
        ))}
      </select>

      <select aria-label="Owner" value={filters.assignedTo || ''} onChange={set('assignedTo')}>
        <option value="">{ownerScopeHint || 'Any owner'}</option>
        {ownerOptions.map((person) => (
          <option key={person.id} value={person.id}>{person.name}</option>
        ))}
      </select>

      <select aria-label="Scope" value={filters.scope || 'all'} onChange={set('scope')}>
        <option value="all">All tickets</option>
        <option value="assigned">Assigned to me</option>
        <option value="reported">Reported by me</option>
        <option value="unassigned">Unassigned</option>
      </select>

      <button
        type="button"
        className={`btn btn-sm${filters.blocked ? ' chip-on' : ''}`}
        aria-pressed={Boolean(filters.blocked)}
        onClick={() => toggle('blocked')}
      >
        Blocked
      </button>
      <button
        type="button"
        className={`btn btn-sm${filters.overdue ? ' chip-on' : ''}`}
        aria-pressed={Boolean(filters.overdue)}
        onClick={() => toggle('overdue')}
      >
        Overdue
      </button>
      <button
        type="button"
        className={`btn btn-sm${filters.reopened ? ' chip-on' : ''}`}
        aria-pressed={Boolean(filters.reopened)}
        onClick={() => toggle('reopened')}
      >
        Reopened
      </button>

      {showReset && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onReset}
          disabled={resetBusy}
        >
          {resetBusy ? 'Resetting…' : 'Reset to default'}
        </button>
      )}
    </div>
  );
}
