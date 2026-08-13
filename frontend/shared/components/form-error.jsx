'use client';

import { useEffect, useState } from 'react';
import { copyErrorId, logApiError } from '@/shared/lib/api-error.js';

export default function FormError({ error }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!error) return undefined;
    logApiError(error);
    setCopied(false);
    return undefined;
  }, [error]);

  if (!error) return null;

  async function onCopyId() {
    const ok = await copyErrorId(error.requestId);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="banner" role="alert">
      <div>
        <div>{error.message}</div>
        {error.fields && (
          <ul className="banner-fields">
            {Object.entries(error.fields).map(([field, message]) => (
              <li key={field}>{String(message)}</li>
            ))}
          </ul>
        )}
        {error.requestId ? (
          <div className="banner-support">
            <button type="button" className="btn btn-sm" onClick={onCopyId}>
              {copied ? 'Copied' : 'Copy error ID'}
            </button>
            <span className="meta">For support</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
