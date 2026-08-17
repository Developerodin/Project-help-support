'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { initials } from '../icons.jsx';

const SUBTITLES = {
  user: 'Choose who should own this ticket.',
  team: 'Choose which team owns this ticket.',
  generic: 'Choose an option.',
};

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="6.75" cy="6.75" r="4.25" />
      <path d="m10 10 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m3.5 8.25 3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
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
  const searchRef = useRef(null);
  const closeRef = useRef(null);
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const showSearch = kind === 'user' || options.length > 6;
  const subtitle = SUBTITLES[kind] || SUBTITLES.generic;

  useEffect(() => {
    if (!open) {
      setSearch('');
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      if (showSearch) searchRef.current?.focus();
      else closeRef.current?.focus();
    });

    function onKeyDown(event) {
      if (event.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange, showSearch]);

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

  const overlay = open && mounted ? createPortal(
    <div
      className="rail-picker-overlay on"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="rail-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="rail-picker-sheet__head">
          <div className="rail-picker-sheet__intro">
            <h3 id={titleId}>{label}</h3>
            <p id={descId}>{subtitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rail-picker-sheet__close"
            aria-label={`Close ${label.toLowerCase()} picker`}
            onClick={() => onOpenChange(false)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {showSearch ? (
          <div className="rail-picker-sheet__search">
            <SearchGlyph />
            <input
              ref={searchRef}
              type="search"
              className="rail-picker-search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${label.toLowerCase()}`}
            />
          </div>
        ) : null}

        {!loadingOptions && !optionsError && filtered.length > 0 ? (
          <p className="rail-picker-sheet__cap">
            <span>{search.trim() ? 'Matches' : kind === 'user' ? 'People' : 'Options'}</span>
            <span className="rail-picker-sheet__count">{filtered.length}</span>
          </p>
        ) : null}

        <div className="rail-picker-scroll" role="listbox" aria-label={`Select ${label.toLowerCase()}`}>
          {loadingOptions ? (
            <p className="rail-picker-cap">Loading…</p>
          ) : optionsError ? (
            <p className="rail-picker-cap">{optionsError}</p>
          ) : filtered.length === 0 ? (
            <p className="rail-picker-cap">No matches</p>
          ) : (
            filtered.map((option) => {
              const selected = value?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="rail-picker-item"
                  disabled={assigning}
                  onClick={() => onSelect(option.id)}
                >
                  {kind === 'user' ? (
                    <span className="avatar sm rail-picker-item__avatar">{initials(option.name)}</span>
                  ) : null}
                  <span className={kind === 'user' ? 'member-picker__label' : 'rail-picker-item__text'}>
                    <b>{option.name}</b>
                    {option.subtitle ? <span>{option.subtitle}</span> : null}
                  </span>
                  {option.meta ? <span className="k">{option.meta}</span> : null}
                  {selected ? (
                    <span className="rail-picker-item__check" aria-hidden="true">
                      <CheckGlyph />
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`rail-picker${open ? ' is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`rail-picker-trigger${value ? '' : ' v empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={value ? `Change ${label}` : `Assign ${label}`}
        disabled={disabled || assigning}
        aria-busy={assigning || undefined}
        onClick={() => onOpenChange(!open)}
      >
        <span className="rail-picker-trigger__value">
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
        </span>
        {assigning ? (
          <span className="btn-spin" aria-hidden="true" />
        ) : (
          <span className="rail-picker-trigger__action" aria-hidden="true">Change</span>
        )}
      </button>

      {overlay}
    </div>
  );
}
