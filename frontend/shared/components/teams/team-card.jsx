'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { initials } from '@/shared/components/icons.jsx';

function ChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export default function TeamCard({
  team,
  users,
  onAddMembers,
  onRequestRemove,
  addBusy = false,
  removingMemberId = null,
}) {
  const memberIds = useMemo(() => new Set(team.members.map((m) => m.id)), [team.members]);
  const available = useMemo(
    () => users.filter((u) => !memberIds.has(u.id)),
    [users, memberIds],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setPickerOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    );
  }, [available, search]);

  function toggleUser(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submitAdd() {
    if (selected.length === 0 || addBusy) return;
    await onAddMembers(team.id, selected);
    setSelected([]);
    setSearch('');
    setPickerOpen(false);
  }

  return (
    <section className="panel team-panel">
      <header>
        <h3>{team.name}</h3>
        <span className="spacer" />
        <Link href={`/teams/${team.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
        <span className="chip">{team.project ? team.project.key : 'global'}</span>
      </header>

      <div className="team-members">
        <div className="team-panel__members-head">
          <span className="lbl">Members</span>
          <span className="meta">{team.members.length}</span>
        </div>

        {team.members.length === 0 ? (
          <p className="team-members__empty">Add people to route tickets to this team.</p>
        ) : (
          <ul className="team-members__list">
            {team.members.map((member) => {
              const removing = removingMemberId === member.id;
              return (
                <li key={member.id} className="member-chip">
                  <span className="avatar sm" title={member.name}>{initials(member.name)}</span>
                  <span className="member-chip__name">{member.name}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm member-chip__remove"
                    aria-label={`Remove ${member.name}`}
                    disabled={removing || addBusy}
                    aria-busy={removing || undefined}
                    onClick={() => onRequestRemove(team, member)}
                  >
                    {removing ? (
                      <>
                        <span className="btn-spin" aria-hidden="true" />
                        Removing…
                      </>
                    ) : (
                      'Remove'
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="team-panel__add">
        <div className="menuwrap" ref={wrapRef}>
          <button
            type="button"
            className="btn btn-sm"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            disabled={addBusy || available.length === 0}
            onClick={() => setPickerOpen((v) => !v)}
          >
            {addBusy ? (
              <>
                <span className="btn-spin" aria-hidden="true" />
                Adding…
              </>
            ) : (
              <>
                Add members
                <ChevronDown />
              </>
            )}
          </button>

          {pickerOpen && (
            <div className="menu on left wide member-picker-menu" role="listbox" aria-label="Select members to add">
              <input
                type="search"
                className="menusearch"
                placeholder="Search people…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search people"
              />
              <div className="menuscroll">
                {filtered.length === 0 ? (
                  <p className="menucap meta">No matching people</p>
                ) : (
                  filtered.map((user) => {
                    const checked = selected.includes(user.id);
                    return (
                      <label key={user.id} className="menuitem menuitem--check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUser(user.id)}
                        />
                        <span className="avatar sm">{initials(user.name)}</span>
                        <span className="member-picker__label">
                          <b>{user.name}</b>
                          {user.email ? <span>{user.email}</span> : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className="member-picker-foot">
                <span className="meta">{selected.length} selected</span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => { setSelected([]); setPickerOpen(false); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={selected.length === 0 || addBusy}
                  onClick={submitAdd}
                >
                  Add {selected.length || ''}
                </button>
              </div>
            </div>
          )}
        </div>
        {available.length === 0 && team.members.length > 0 && (
          <p className="field-hint">Everyone active is already on this team.</p>
        )}
      </div>
    </section>
  );
}
