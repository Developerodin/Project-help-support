'use client';

import { useProject } from '@/shared/contexts/project-context.jsx';

/** Non-blocking notice for external users with no company/project assignment. */
export default function ExternalWorkspaceNotice() {
  const { hasWorkspace, loading } = useProject();

  if (loading || hasWorkspace) return null;

  return (
    <div className="banner external-workspace-notice" role="status">
      <span>
        <strong>No workspace assigned.</strong>
        {' '}
        You haven&apos;t been assigned to a company or project yet.
        Contact your administrator for access.
      </span>
    </div>
  );
}
