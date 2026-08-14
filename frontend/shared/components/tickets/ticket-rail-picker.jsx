'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { initials } from '../icons.jsx';

function ChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="chev">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export default function TicketRailPicker({
  label,
  emptyLabel,
  value,
  options = [],
  loadingOptions = false,
  optionsError = null,
  open,
  onOpenChange,
  onSelect,
  assigning = false,
  disabled = false,
  searchPlaceholder = 'Search…',
  kind = 'generic',
}) {
  const wrapRef = useRef(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) {
      setSearch('');
      return undefined;
    }
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) onOpenChange(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => {
      const hay = [option.name, option.subtitle, option.meta]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [options, search]);

  const triggerLabel = value?.name || emptyLabel;
  const showSearch = kind === 'user' || options.length > 6;

  return (
    <div className="rail-picker" ref={wrapRef}>
      <button
        type="button"
        className={`rail-picker-trigger${value ? '' : ' v empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={value ? `Change ${label}` : `Assign ${label}`}
        disabled={disabled || assigning}
        aria-busy={assigning || undefined}
        onClick={() => onOpenChange(!open)}
      >
        {value ? (
          kind === 'user' ? (
            <span className="personline">
              <span className="avatar sm" title={value.name}>{initials(value.name)}</span>
              {value.name}
            </span>
          ) : (
            <span className="v">{value.name}</span>
          )
        ) : (
          <span>{triggerLabel}</span>
        )}
        {assigning ? (
          <span className="btn-spin" aria-hidden="true" />
        ) : (
          <ChevronDown />
        )}
      </button>

      {open && (
        <div className="rail-picker-menu" role="listbox" aria-label={`Select ${label.toLowerCase()}`}>
          {showSearch && (
            <input
              type="search"
              className="rail-picker-search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${label.toLowerCase()}`}
            />
          )}
          <div className="rail-picker-scroll">
            {loadingOptions ? (
              <p className="rail-picker-cap">Loading…</p>
            ) : optionsError ? (
              <p className="rail-picker-cap">{optionsError}</p>
            ) : filtered.length === 0 ? (
              <p className="rail-picker-cap">No matches</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={value?.id === option.id}
                  className="rail-picker-item"
                  disabled={assigning}
                  onClick={() => onSelect(option.id)}
                >
                  {kind === 'user' && (
                    <span className="avatar sm">{initials(option.name)}</span>
                  )}
                  <span className={kind === 'user' ? 'member-picker__label' : undefined}>
                    <b>{option.name}</b>
                    {option.subtitle ? <span>{option.subtitle}</span> : null}
                  </span>
                  {option.meta ? <span className="k">{option.meta}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
