'use client';

import { getUserRoles } from '@pms/shared';
import { capRole } from '@/shared/lib/profile-utils.js';

export default function RoleBadges({ user, roles, maxVisible = 3, className = '' }) {
  const list = roles?.length ? roles : getUserRoles(user);
  if (!list.length) return <span className="role-badges role-badges--empty">—</span>;

  const visible = list.slice(0, maxVisible);
  const overflow = list.slice(maxVisible);
  const overflowLabel = overflow.map(capRole).join(', ');

  return (
    <span className={`role-badges${className ? ` ${className}` : ''}`}>
      {visible.map((role) => (
        <span key={role} className="chip chip-sm role-badge">{capRole(role)}</span>
      ))}
      {overflow.length > 0 && (
        <span className="chip chip-sm role-badge role-badge--overflow" title={overflowLabel}>
          +{overflow.length}
        </span>
      )}
    </span>
  );
}
