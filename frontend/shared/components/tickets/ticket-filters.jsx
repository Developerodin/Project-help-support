'use client';

import { useEffect, useRef, useState } from 'react';
import { STAGES, PRIORITIES, CATEGORIES, SEVERITIES, TICKET_SEARCH_MAX_LENGTH } from '@pms/shared';
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
  ownerNotInList = false,
  searchNoOpHint = false,
  onReset,
  resetBusy = false,
  showReset = false,
}) {
  const searchRef = useRef(null);
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const ownerSelectValue = filters.assignedTo || '';
  const ownerInList = !ownerSelectValue || ownerOptions.some((p) => p.id === ownerSelectValue);

  const controls = (
    <>
      <div className="ticket-filters__search-wrap">
        <input
          ref={searchRef}
          id={TICKET_SEARCH_INPUT_ID}
          className="filterin"
          type="search"
          aria-label="Filter tickets"
          aria-describedby={searchNoOpHint ? 'ticket-search-hint' : undefined}
          placeholder="Filter by number, title or module"
          maxLength={TICKET_SEARCH_MAX_LENGTH}
          value={searchValue ?? filters.q ?? ''}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {searchNoOpHint ? (
          <p id="ticket-search-hint" className="ticket-filters__hint" role="status">
            Add at least two letters or a ticket number — punctuation alone is ignored.
          </p>
        ) : null}
      </div>

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

      <select aria-label="Owner" value={ownerSelectValue} onChange={set('assignedTo')}>
        <option value="">{ownerScopeHint || 'Any owner'}</option>
        {!ownerInList && ownerSelectValue ? (
          <option value={ownerSelectValue}>
            {ownerNotInList ? 'Owner (not in list)' : 'Selected owner'}
          </option>
        ) : null}
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
    </>
  );

  return (
    <div className="ticket-filters">
      <div className="toolbar ticket-filters__bar ticket-filters__bar--desktop">
        {controls}
      </div>

      <div className="ticket-filters__mobile">
        <div className="toolbar ticket-filters__bar ticket-filters__bar--mobile-head">
          <div className="ticket-filters__search-wrap ticket-filters__search-wrap--grow">
            <input
              className="filterin"
              type="search"
              aria-label="Filter tickets on mobile"
              aria-describedby={searchNoOpHint ? 'ticket-search-hint-mobile' : undefined}
              placeholder="Search tickets"
              maxLength={TICKET_SEARCH_MAX_LENGTH}
              value={searchValue ?? filters.q ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            {searchNoOpHint ? (
              <p id="ticket-search-hint-mobile" className="ticket-filters__hint" role="status">
                Add at least two letters or a ticket number — punctuation alone is ignored.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-sm ticket-filters__toggle"
            aria-expanded={mobileOpen}
            aria-controls="ticket-filters-sheet"
            onClick={() => setMobileOpen((open) => !open)}
          >
            Filters
          </button>
        </div>
        {mobileOpen ? (
          <div id="ticket-filters-sheet" className="ticket-filters__sheet toolbar">
            {controls}
          </div>
        ) : null}
      </div>
    </div>
  );
}
