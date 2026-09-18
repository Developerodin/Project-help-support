'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { initials } from '@/shared/components/icons.jsx';
import { getUser } from '@/shared/api/users.js';
import { useActiveUserSearch } from '@/shared/hooks/use-active-user-search.js';

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="6.75" cy="6.75" r="4.25" />
      <path d="m10 10 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

function displayName(user) {
  return user?.name?.trim() || user?.email || 'User';
}

/**
 * Single-person filter for RBAC audit (actor / target). Stores user id in query;
 * search is by name or email via GET /users?q=….
 */
export default function AuditUserFilter({
  label,
  value = '',
  onChange,
  helperText = 'Search people by name or email',
}) {
  const baseId = useId();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const skipResolveRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [resolvedUser, setResolvedUser] = useState(null);
  const [resolving, setResolving] = useState(false);

  const {
    query: search,
    setQuery: setSearch,
    available,
    loading: searchLoading,
    error: searchError,
    retry,
  } = useActiveUserSearch({ enabled: open && !value });

  useEffect(() => {
    if (!value) {
      setResolvedUser(null);
      setResolving(false);
      return undefined;
    }
    if (skipResolveRef.current === value) {
      skipResolveRef.current = null;
      return undefined;
    }
    let cancelled = false;
    setResolving(true);
    getUser(value)
      .then((user) => {
        if (!cancelled) {
          setResolvedUser(user);
          setResolving(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedUser({ id: value, name: 'Unknown user', email: '' });
          setResolving(false);
        }
      });
    return () => { cancelled = true; };
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const labelId = `${baseId}-label`;
  const listboxId = `${baseId}-listbox`;
  const helperId = helperText ? `${baseId}-helper` : undefined;
  const trimmed = search.trim();

  function selectUser(user) {
    skipResolveRef.current = user.id;
    setResolvedUser(user);
    onChange(user.id);
    setSearch('');
    setOpen(false);
  }

  function clear() {
    setResolvedUser(null);
    onChange('');
    setSearch('');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (value && resolving) {
    return (
      <div className="rbac-audit-field audit-user-filter" ref={wrapRef}>
        <span className="rbac-audit-field__label" id={labelId}>{label}</span>
        <div
          className="audit-user-filter__skeleton"
          aria-busy="true"
          aria-labelledby={labelId}
        >
          <span className="audit-user-filter__skeleton-bar" />
        </div>
      </div>
    );
  }

  if (value && resolvedUser) {
    return (
      <div className="rbac-audit-field audit-user-filter" ref={wrapRef}>
        <span className="rbac-audit-field__label" id={labelId}>{label}</span>
        <div className="audit-user-filter__picked" aria-labelledby={labelId}>
          <span className="audit-user-filter__chip">
            <span className="avatar sm" aria-hidden="true">{initials(displayName(resolvedUser))}</span>
            <span className="audit-user-filter__chip-text">
              <b>{displayName(resolvedUser)}</b>
              {resolvedUser.email ? <span>{resolvedUser.email}</span> : null}
            </span>
          </span>
          <button
            type="button"
            className="audit-user-filter__clear"
            onClick={clear}
            aria-label={`Clear ${label} filter`}
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rbac-audit-field audit-user-filter" ref={wrapRef}>
      <span className="rbac-audit-field__label" id={labelId}>{label}</span>
      {helperText ? (
        <span className="sr-only" id={helperId}>{helperText}</span>
      ) : null}
      <div className="audit-user-filter__search">
        <span className="audit-user-filter__search-icon" aria-hidden="true">
          <SearchGlyph />
        </span>
        <input
          ref={inputRef}
          id={baseId}
          type="search"
          inputMode="search"
          autoComplete="off"
          className="audit-user-filter__input"
          placeholder="Name or email…"
          value={search}
          aria-labelledby={labelId}
          aria-describedby={helperId}
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
        />
        {open ? (
          <div
            id={listboxId}
            className="audit-user-filter__dropdown"
            role="listbox"
            aria-labelledby={labelId}
          >
            {searchLoading ? (
              <p className="audit-user-filter__dropdown-empty">Searching people…</p>
            ) : searchError ? (
              <div className="audit-user-filter__dropdown-empty">
                <p>{searchError}</p>
                <button type="button" className="btn btn-sm" onClick={() => retry?.()}>
                  Retry
                </button>
              </div>
            ) : available.length === 0 ? (
              <p className="audit-user-filter__dropdown-empty">
                {trimmed ? 'No matches. Try another name or email.' : 'Type a name or email to search.'}
              </p>
            ) : (
              <ul className="audit-user-filter__options">
                {available.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="audit-user-filter__option"
                      onClick={() => selectUser(user)}
                    >
                      <span className="avatar sm" aria-hidden="true">{initials(displayName(user))}</span>
                      <span className="audit-user-filter__option-who">
                        <b>{displayName(user)}</b>
                        {user.email ? <span>{user.email}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
