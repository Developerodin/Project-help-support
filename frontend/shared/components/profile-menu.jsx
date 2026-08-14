'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { updateMe } from '@/shared/api/users.js';
import { initials } from '@/shared/components/icons.jsx';
import FormError from '@/shared/components/form-error.jsx';
import { showToast } from '@/shared/lib/toast.js';

function capRole(role) {
  if (!role) return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function ProfileMenu() {
  const { user, logout, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name || '');
  }, [open, user?.id, user?.name]);

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

  if (!user) return null;

  const trimmed = name.trim();
  const nameChanged = trimmed !== (user.name || '').trim();

  async function saveName(event) {
    event.preventDefault();
    if (!trimmed || !nameChanged) return;
    setError(null);
    setBusy(true);
    try {
      const updated = await updateMe({ name: trimmed });
      await refreshUser(updated);
      showToast('Profile updated');
      setOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setOpen(false);
    await logout();
  }

  return (
    <div className="menuwrap profile-menu" ref={wrapRef}>
      <button
        type="button"
        id="meAvatar"
        className="avatar avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
        title={user.name || user.email}
        onClick={() => setOpen((value) => !value)}
      >
        {initials(user.name || user.email)}
      </button>

      <div className={`menu wide profile-menu__panel${open ? ' on' : ''}`} role="menu">
        <div className="menucap profile-menu__head">
          <span className="avatar lg">{initials(user.name || user.email)}</span>
          <div>
            <strong>{user.name || 'Unnamed'}</strong>
            <p className="meta">{user.email}</p>
            <span className="chip">{capRole(user.role)}</span>
          </div>
        </div>

        <form className="profile-menu__form" onSubmit={saveName}>
          <FormError error={error} />
          <div className="form-row">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              minLength={1}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy || !trimmed || !nameChanged}
            aria-busy={busy || undefined}
          >
            {busy ? 'Saving…' : 'Save name'}
          </button>
        </form>

        <div className="menusep" />

        <Link
          href="/forgot-password"
          className="menuitem"
          role="menuitem"
          onClick={() => setOpen(false)}
        >
          Change password
        </Link>

        <button
          type="button"
          className="menuitem danger"
          role="menuitem"
          onClick={handleLogout}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
