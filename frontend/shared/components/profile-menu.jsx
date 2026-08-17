'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { initials } from '@/shared/components/icons.jsx';
import { canAccessAdminPanel, capRole } from '@/shared/lib/profile-utils.js';

const PERSONAL_INFORMATION_HREF = '/profile#profile-personal-information';
const ADMIN_PANEL_HOME = '/admin';
const USER_PANEL_HOME = '/profile';
const ADMIN_PANEL_PATHS = ['/admin', '/users', '/projects', '/teams', '/settings/notifications'];

function isAdminPanelPath(pathname) {
  if (!pathname) return false;
  return ADMIN_PANEL_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default function ProfileMenu() {
  const { user } = useAuth();
  const wrapRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isAdminTier = canAccessAdminPanel(user?.role);
  const adminPanelOn = isAdminTier && isAdminPanelPath(pathname);

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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function handleAdminPanelToggle() {
    router.push(adminPanelOn ? USER_PANEL_HOME : ADMIN_PANEL_HOME);
    setOpen(false);
  }

  if (!user) return null;

  return (
    <div className="menuwrap" ref={wrapRef}>
      <button
        type="button"
        id="meAvatar"
        className="avatar avatar-btn"
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.name || user.email}
        onClick={() => setOpen((value) => !value)}
      >
        {initials(user.name || user.email)}
      </button>

      <div className={`menu profile-menu__panel${open ? ' on' : ''}`} role="menu" aria-label="Profile menu">
        <div className="menucap profile-menu__head">
          <span className="avatar sm" aria-hidden="true">{initials(user.name || user.email)}</span>
          <div>
            <strong>{user.name || 'Unnamed'}</strong>
            <p className="meta">{user.email}</p>
            <span className="chip profile-menu__chip">{capRole(user.role)}</span>
          </div>
        </div>
        <div className="menusep" />
        <Link
          href={PERSONAL_INFORMATION_HREF}
          className="menuitem"
          role="menuitem"
          onClick={() => setOpen(false)}
        >
          Personal information
        </Link>
        <Link href="/profile" className="menuitem" role="menuitem" onClick={() => setOpen(false)}>
          Profile overview
        </Link>
        {isAdminTier ? (
          <>
            <div className="menusep" />
            <div className="menucap profile-menu__section-label">Administration</div>
            <button
              type="button"
              className="menuitem profile-menu__toggle"
              role="menuitemcheckbox"
              aria-checked={adminPanelOn}
              aria-label={adminPanelOn ? 'Switch to user panel' : 'Switch to admin panel'}
              onClick={handleAdminPanelToggle}
            >
              <span>{adminPanelOn ? 'Exit admin panel' : 'Open admin panel'}</span>
              <span className="k">{adminPanelOn ? 'On' : 'Off'}</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
