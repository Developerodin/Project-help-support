'use client';

export default function PreviewBanner() {
  return (
    <div className="rbac-preview-banner" role="status">
      <strong>RBAC admin</strong>
      <span>
        Live data from
        {' '}
        <code>/v1/rbac</code>
        {' '}
        and
        {' '}
        <code>/v1/users</code>
        . Changes persist immediately.
      </span>
    </div>
  );
}
