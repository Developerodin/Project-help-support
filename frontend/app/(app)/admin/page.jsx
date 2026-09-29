'use client';

import Link from 'next/link';
import { can } from '@pms/shared';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import Icon from '@/shared/components/icons.jsx';
import { canAccessAdminPanel } from '@/shared/lib/profile-utils.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';

const ADMIN_DESTINATIONS = [
  {
    href: '/users',
    label: 'People',
    description: 'Invite users, assign roles, and manage access.',
    icon: 'user',
    primary: true,
  },
  {
    href: '/projects',
    label: 'Projects',
    description: 'Create projects and configure workspace settings.',
    icon: 'layers',
  },
  {
    href: '/teams',
    label: 'Teams',
    description: 'Organize members and link teams to projects.',
    icon: 'teams',
  },
];

const AUDIT_DESTINATION = {
  href: '/audit-log',
  label: 'Audit log',
  description: 'Review policy and scoped access changes across the workspace.',
  icon: 'list',
};

export default function AdminPage() {
  const { user } = useAuth();
  const { permissionContext } = usePermissionContext();
  const permCtx = permissionContextForUi(permissionContext);
  const canViewAudit = Boolean(user && can(user, 'audit.view', permCtx ?? undefined));

  if (!user) return null;

  if (!canAccessAdminPanel(user)) {
    return (
      <div className="admin-page">
        <nav className="crumb" aria-label="Breadcrumb">
          <span aria-current="page">Admin panel</span>
        </nav>

        <div className="page-head">
          <div>
            <h1>Admin panel</h1>
            <p className="sub">Workspace administration and configuration.</p>
          </div>
        </div>

        <div className="empty-state" role="alert">
          <h3>Access denied</h3>
          <p>You need administrator permissions to view this page.</p>
          <Link href="/profile" className="btn">
            Back to profile
          </Link>
        </div>
      </div>
    );
  }

  const destinations = canViewAudit
    ? [...ADMIN_DESTINATIONS, AUDIT_DESTINATION]
    : ADMIN_DESTINATIONS;

  return (
    <div className="admin-page">
      <nav className="crumb" aria-label="Breadcrumb">
        <span aria-current="page">Admin panel</span>
      </nav>

      <div className="page-head">
        <div>
          <h1>Admin panel</h1>
          <p className="sub">Manage people, projects, teams, and workspace settings.</p>
        </div>
      </div>

      <div className="admin-hub" role="region" aria-label="Admin destinations">
        {destinations.map((destination) => (
          <Link
            key={destination.href}
            href={destination.href}
            className="panel admin-hub-card"
          >
            <span className="admin-hub-card__icon" aria-hidden="true">
              <Icon name={destination.icon} size={18} />
            </span>
            <span className="admin-hub-card__copy">
              <strong>{destination.label}</strong>
              <p>{destination.description}</p>
            </span>
            <span className={`btn btn-sm${destination.primary ? ' btn-primary' : ''}`}>
              Open
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
