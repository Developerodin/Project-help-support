'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ponytail: role baseline, per-user deltas, and audit trail — no mock-only screens.
const PREVIEW_LINKS = [
  { href: '/settings/rbac-preview/matrix', label: 'User roles' },
  { href: '/settings/rbac-preview/board-permissions', label: 'Board permissions' },
  { href: '/settings/rbac-preview/people-access', label: 'People & overrides' },
  { href: '/settings/rbac-preview/audit-log', label: 'Audit log' },
];

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function RbacPreviewNav() {
  const pathname = usePathname();

  return (
    <nav className="rbac-preview-nav" aria-label="Permission Matrix sections">
      {PREVIEW_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`rbac-preview-nav__link${isActive(pathname, link.href) ? ' is-active' : ''}`}
          aria-current={isActive(pathname, link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
