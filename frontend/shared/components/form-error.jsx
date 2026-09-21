'use client';

import { useEffect, useState } from 'react';
import { copyErrorId, logApiError, normalizeApiError, shouldLogApiError } from '@/shared/lib/api-error.js';
import Icon from '@/shared/components/icons.jsx';

export default function FormError({
  error, onDismiss, title, variant: variantProp,
}) {
  const [copied, setCopied] = useState(false);
  const normalized = normalizeApiError(error);
  const variant = variantProp || error?.variant || 'error';
  const isInfo = variant === 'info';

  useEffect(() => {
    if (!error) return undefined;
    if (shouldLogApiError(error)) logApiError(error);
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
    <div
      className={`banner${isInfo ? ' banner--info' : ''}`}
      role={isInfo ? 'status' : 'alert'}
      aria-live={isInfo ? 'polite' : 'assertive'}
    >
      <Icon name={isInfo ? 'info' : 'alert'} size={16} aria-hidden="true" />
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
