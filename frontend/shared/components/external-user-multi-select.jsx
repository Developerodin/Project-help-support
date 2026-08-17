'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { initials } from '@/shared/components/icons.jsx';

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
 * Searchable multi-select for external users (client / client_tester roles).
 * Selected users render as removable chips; locked ids stay selected but cannot be removed.
 */
export default function ExternalUserMultiSelect({
  label,
  users = [],
  selectedIds = [],
  onChange,
  disabled = false,
  loading = false,
  emptyMessage = 'No users available. Invite users from People.',
  lockedIds = [],
  lockedBadge = 'Company-wide',
  maxVisibleChips = 4,
}) {
  const baseId = useId();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  const lockedSet = useMemo(() => new Set(lockedIds), [lockedIds]);

  const userMap = useMemo(() => {
    const map = new Map();
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users]);

  const picked = useMemo(
    () => selectedIds
      .map((id) => userMap.get(id) || { id, name: id, email: '' })
      .filter(Boolean),
    [selectedIds, userMap],
  );

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return users;
    return users.filter(
      (user) => displayName(user).toLowerCase().includes(query)
        || user.email?.toLowerCase().includes(query),
    );
  }, [users, query]);

  const visibleChips = expanded ? picked : picked.slice(0, maxVisibleChips);
  const hiddenCount = expanded ? 0 : Math.max(0, picked.length - maxVisibleChips);

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

  function toggleUser(userId) {
    if (disabled || lockedSet.has(userId)) return;
    onChange(
      selectedIds.includes(userId)
        ? selectedIds.filter((id) => id !== userId)
        : [...selectedIds, userId],
    );
  }

  function removeUser(userId) {
    if (disabled || lockedSet.has(userId)) return;
    onChange(selectedIds.filter((id) => id !== userId));
  }

  const listboxId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;

  return (
    <div className="external-user-ms" ref={wrapRef}>
      <span className="external-user-ms__label" id={labelId}>{label}</span>

      {picked.length > 0 ? (
        <ul className="external-user-ms__chips" aria-labelledby={labelId}>
          {visibleChips.map((user) => {
            const locked = lockedSet.has(user.id);
            return (
              <li key={user.id}>
                <span className={`external-user-ms__chip${locked ? ' is-locked' : ''}`}>
                  <span className="avatar sm" aria-hidden="true">{initials(displayName(user))}</span>
                  <span className="external-user-ms__chip-name">{displayName(user)}</span>
                  {locked ? (
                    <span className="chip external-user-ms__chip-badge">{lockedBadge}</span>
                  ) : (
                    <button
                      type="button"
                      className="external-user-ms__chip-remove"
                      onClick={() => removeUser(user.id)}
                      disabled={disabled}
                      aria-label={`Remove ${displayName(user)}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              </li>
            );
          })}
          {hiddenCount > 0 ? (
            <li>
              <button
                type="button"
                className="external-user-ms__more"
                onClick={() => setExpanded(true)}
              >
                +{hiddenCount} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {loading ? (
        <p className="external-user-ms__empty">Loading users…</p>
      ) : users.length === 0 ? (
        <p className="external-user-ms__empty">{emptyMessage}</p>
      ) : (
        <div className="external-user-ms__search">
          <SearchGlyph />
          <input
            ref={inputRef}
            id={baseId}
            type="search"
            className="external-user-ms__input"
            placeholder="Search by name or email…"
            value={search}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            aria-autocomplete="list"
            role="combobox"
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
          />

          {open ? (
            <div
              id={listboxId}
              className="external-user-ms__dropdown"
              role="listbox"
              aria-labelledby={labelId}
            >
              {filtered.length === 0 ? (
                <p className="external-user-ms__dropdown-empty">No matches. Try another name or email.</p>
              ) : (
                <ul className="external-user-ms__options">
                  {filtered.map((user) => {
                    const checked = selectedIds.includes(user.id);
                    const locked = lockedSet.has(user.id);
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={checked}
                          className={`external-user-ms__option${checked ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                          disabled={disabled || locked}
                          onClick={() => toggleUser(user.id)}
                        >
                          <span className="avatar sm" aria-hidden="true">{initials(displayName(user))}</span>
                          <span className="external-user-ms__option-who">
                            <b>{displayName(user)}</b>
                            {user.email ? <span>{user.email}</span> : null}
                          </span>
                          {locked ? <span className="chip external-user-ms__chip-badge">{lockedBadge}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
