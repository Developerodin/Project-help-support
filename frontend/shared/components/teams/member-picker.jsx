'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon, { initials } from '@/shared/components/icons.jsx';
import { useActiveUserSearch } from '@/shared/hooks/use-active-user-search.js';

function ChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="6.75" cy="6.75" r="4.25" />
      <path d="m10 10 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Searchable multi-select of people for team membership.
 * With `serverSearch`, lookups use GET /users?q=… (debounced) so users beyond
 * the default first page are findable. `excludeMemberIds` keeps current members
 * out of the list.
 */
export default function MemberPicker({
  available: availableProp,
  excludeMemberIds = [],
  serverSearch = false,
  loading: loadingProp = false,
  busy = false,
  onConfirm,
  title = 'Add team members',
  subtitle = 'Select people to add to this team.',
  variant = 'menu',
  triggerLabel = 'Add members',
  busyLabel = 'Adding…',
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState(() => new Map());
  const wrapRef = useRef(null);

  const excludeList = useMemo(
    () => excludeMemberIds.map((id) => String(id)),
    [excludeMemberIds],
  );

  const {
    query: search,
    setQuery: setSearch,
    available: serverAvailable,
    loading: serverLoading,
    error: serverError,
    retry,
  } = useActiveUserSearch({ enabled: open && serverSearch, excludeIds: excludeList });

  const available = serverSearch ? serverAvailable : (availableProp ?? []);
  const loading = serverSearch ? serverLoading : loadingProp;
  const trimmedQuery = search.trim();

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

  const picked = useMemo(
    () => selected.map((id) => selectedUsers.get(id)).filter(Boolean),
    [selected, selectedUsers],
  );

  function toggle(id) {
    if (selected.includes(id)) {
      setSelected((prev) => prev.filter((x) => x !== id));
      setSelectedUsers((map) => {
        const next = new Map(map);
        next.delete(id);
        return next;
      });
      return;
    }
    const user = available.find((u) => u.id === id) || selectedUsers.get(id);
    if (user) {
      setSelectedUsers((map) => new Map(map).set(id, user));
    }
    setSelected((prev) => [...prev, id]);
  }

  function close() {
    setSelected([]);
    setSelectedUsers(new Map());
    setSearch('');
    setOpen(false);
  }

  async function submit() {
    if (selected.length === 0 || busy) return;
    const users = selected.map((id) => selectedUsers.get(id)).filter(Boolean);
    await onConfirm(selected, users);
    close();
  }

  const listEmpty = !loading && !serverError && available.length === 0;
  const showTypeToSearch = serverSearch && listEmpty && !trimmedQuery && !loading;

  return (
    <div className="menuwrap" ref={wrapRef}>
      <button
        type="button"
        className={variant === 'menu' ? 'btn btn-sm' : 'btn member-picker__trigger'}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={busy || (!serverSearch && available.length === 0 && !loading)}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? (
          <>
            <span className="btn-spin" aria-hidden="true" />
            {busyLabel}
          </>
        ) : (
          <>
            {variant === 'action' ? <Icon name="plus" size={12} /> : null}
            {triggerLabel}
            {variant === 'menu' ? <ChevronDown /> : null}
          </>
        )}
      </button>

      {open && (
        <div
          className={`member-picker${variant === 'action' ? ' member-picker--right' : ''}`}
          role="listbox"
          aria-label="Select members to add"
        >
          <div className="mp-head">
            <div className="mp-head__text">
              <b>{title}</b>
              {subtitle ? <span>{subtitle}</span> : null}
            </div>
            <button type="button" className="mp-head__close" aria-label="Close" onClick={close}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div className="mp-search">
            <SearchGlyph />
            <input
              type="search"
              className="mp-search__input"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search people"
              autoFocus
            />
          </div>

          {picked.length > 0 ? (
            <div className="mp-picked">
              <span className="mp-picked__cap">Selected · {picked.length}</span>
              <ul className="mp-picked__list">
                {picked.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      className="mp-chip"
                      onClick={() => toggle(user.id)}
                      aria-label={`Deselect ${user.name}`}
                    >
                      <span className="avatar sm" aria-hidden="true">{initials(user.name)}</span>
                      <span className="mp-chip__name">{user.name}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && !serverError && available.length > 0 ? (
            <p className="mp-listcap" aria-live="polite">
              <span>{trimmedQuery ? 'Matches' : serverSearch ? 'Suggestions' : 'All people'}</span>
              <span className="mp-listcap__n">{available.length}</span>
            </p>
          ) : null}

          <div className="mp-scroll">
            {loading ? (
              <p className="mp-empty"><span>Searching people…</span></p>
            ) : serverError ? (
              <div className="mp-empty">
                <b>Could not load people</b>
                <span>{serverError}</span>
                <button type="button" className="btn btn-sm" onClick={() => retry?.()}>
                  Retry
                </button>
              </div>
            ) : listEmpty ? (
              <div className="mp-empty">
                <b>{showTypeToSearch ? 'Search for someone' : 'No people found'}</b>
                <span>
                  {showTypeToSearch
                    ? 'Type a name or email to find active users.'
                    : trimmedQuery
                      ? 'Try another name or email.'
                      : 'Everyone active is already on this team.'}
                </span>
              </div>
            ) : (
              available.map((user) => {
                const checked = selected.includes(user.id);
                return (
                  <label key={user.id} className={`mp-row${checked ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      className="mp-row__box"
                      checked={checked}
                      onChange={() => toggle(user.id)}
                    />
                    <span className="avatar mp-row__av" aria-hidden="true">{initials(user.name)}</span>
                    <span className="mp-row__who">
                      <b>{user.name}</b>
                      {user.email ? <span>{user.email}</span> : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="mp-foot">
            <span className="mp-foot__count">{selected.length} selected</span>
            <span className="spacer" />
            <button type="button" className="btn btn-sm" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={selected.length === 0 || busy}
              onClick={submit}
            >
              Add members
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
