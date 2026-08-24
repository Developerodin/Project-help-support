'use client';

import Link from 'next/link';
import { EXTERNAL_ROLES, MATRIX_ROLES, ROLE_LABELS } from '@pms/shared';
import RbacPreviewNav from '@/shared/components/rbac-preview/preview-nav.jsx';

const MANAGEABLE_BOARD_ROLES = MATRIX_ROLES.filter((role) => !EXTERNAL_ROLES.includes(role));

export default function BoardPermissionsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Board permissions</h1>
          <p className="sub">
            Board capabilities are managed per role. Open a role to edit its Intake → Done lane access.
          </p>
        </div>
        <Link href="/settings/rbac-preview/matrix" className="btn btn-sm">
          Back to role list
        </Link>
      </div>

      <RbacPreviewNav />

      <div className="tablewrap rbac-role-list-wrap">
        <table className="rbac-role-list">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col" className="rbac-role-list__actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {MANAGEABLE_BOARD_ROLES.map((role) => (
              <tr key={role}>
                <td>
                  <div className="rbac-role-list__identity">
                    <span className="rbac-role-list__avatar" aria-hidden="true">
                      {(ROLE_LABELS[role] || role).charAt(0)}
                    </span>
                    <strong>{ROLE_LABELS[role] || role}</strong>
                  </div>
                </td>
                <td className="rbac-role-list__actions">
                  <Link
                    href={`/settings/rbac-preview/matrix/${encodeURIComponent(role)}#board-permissions`}
                    className="btn btn-sm btn-primary"
                  >
                    Manage board permissions
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
