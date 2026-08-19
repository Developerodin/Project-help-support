'use client';

import { useEffect, useState } from 'react';
import { copyErrorId, logApiError, normalizeApiError } from '@/shared/lib/api-error.js';
import Icon from '@/shared/components/icons.jsx';

export default function FormError({ error, onDismiss, title }) {
  const [copied, setCopied] = useState(false);
  const normalized = normalizeApiError(error);

  useEffect(() => {
    if (!error) return undefined;
    logApiError(error);
    setCopied(false);
    return undefined;
  }, [error]);

  if (!normalized) return null;

  async function onCopyId() {
    const ok = await copyErrorId(normalized.requestId);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="banner" role="alert" aria-live="assertive">
      <Icon name="alert" size={16} aria-hidden="true" />
      <div className="banner-body">
        {title ? <b>{title}</b> : null}
        <div>{normalized.message}</div>
        {normalized.fields && (
          <ul className="banner-fields">
            {Object.entries(normalized.fields).map(([field, message]) => (
              <li key={field}>{String(message)}</li>
            ))}
          </ul>
        )}
        {normalized.requestId ? (
          <div className="banner-support">
            <button type="button" className="btn btn-sm" onClick={onCopyId}>
              {copied ? 'Copied' : 'Copy error ID'}
            </button>
            <span className="meta">For support</span>
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm banner-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <Icon name="x" size={14} />
            Dismiss
          </button>
        </>
      ) : null}
    </div>
  );
}
