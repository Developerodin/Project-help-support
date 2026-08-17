'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon, { initials } from '@/shared/components/icons.jsx';

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
 * The one searchable multi-select of people, shared by the team cards on
 * /teams and by the team form on create + edit. `available` is already
 * filtered by the caller, which is how "no duplicate members" is enforced:
 * a current member never reaches this list.
 */
export default function MemberPicker({
  available,
  loading = false,
  busy = false,
  onConfirm,
  title = 'Add team members',
  subtitle = 'Select people to add to this team.',
  variant = 'menu',
  triggerLabel = 'Add members',
  busyLabel = 'Adding…',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const wrapRef = useRef(null);

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

  // Selection survives typing: filtering narrows what is shown, never what is picked.
  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return available;
    return available.filter(
      (u) => u.name?.toLowerCase().includes(query) || u.email?.toLowerCase().includes(query),
    );
  }, [available, query]);

  // Chips read from the unfiltered list so a search never hides who is picked.
  const picked = useMemo(
    () => available.filter((u) => selected.includes(u.id)),
    [available, selected],
  );

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function close() {
    setSelected([]);
    setSearch('');
    setOpen(false);
  }

  async function submit() {
    if (selected.length === 0 || busy) return;
    await onConfirm(selected);
    close();
  }

  return (
    <div className="menuwrap" ref={wrapRef}>
      <button
        type="button"
        className={variant === 'menu' ? 'btn btn-sm' : 'btn member-picker__trigger'}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={busy || (available.length === 0 && !loading)}
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

          {!loading && filtered.length > 0 ? (
            <p className="mp-listcap">
              <span>{query ? 'Matches' : 'All people'}</span>
              <span className="mp-listcap__n">{filtered.length}</span>
            </p>
          ) : null}

          <div className="mp-scroll">
            {loading ? (
              <p className="mp-empty"><span>Searching people…</span></p>
            ) : filtered.length === 0 ? (
              <div className="mp-empty">
                <b>No people found</b>
                <span>
                  {available.length === 0
                    ? 'Everyone active is already on this team.'
                    : 'Try another name or email.'}
                </span>
              </div>
            ) : (
              filtered.map((user) => {
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
