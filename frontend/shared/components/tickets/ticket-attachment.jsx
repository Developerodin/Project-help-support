'use client';

import { useCallback, useEffect, useState } from 'react';
import { resolveAttachmentDownloadUrl } from '@/shared/api/tickets.js';

export function useAttachmentDownloadUrl(ticketId, attachmentId) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(Boolean(attachmentId));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticketId || !attachmentId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    resolveAttachmentDownloadUrl(ticketId, attachmentId)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [ticketId, attachmentId]);

  const open = useCallback(async () => {
    const target = url ?? await resolveAttachmentDownloadUrl(ticketId, attachmentId);
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [url, ticketId, attachmentId]);

  return { url, loading, error, open };
}

export function TicketAttachmentLink({
  ticketId,
  attachmentId,
  children,
  className,
  ...props
}) {
  const { loading, error, open } = useAttachmentDownloadUrl(ticketId, attachmentId);

  return (
    <button
      type="button"
      className={className}
      onClick={() => { open().catch(() => {}); }}
      disabled={loading || Boolean(error)}
      aria-busy={loading}
      {...props}
    >
      {children}
    </button>
  );
}

export function TicketAttachmentImage({
  ticketId,
  attachmentId,
  alt,
  className,
  children,
}) {
  const { url, loading, error, open } = useAttachmentDownloadUrl(ticketId, attachmentId);

  return (
    <button
      type="button"
      className={className}
      onClick={() => { open().catch(() => {}); }}
      disabled={loading || Boolean(error)}
      aria-busy={loading}
    >
      {url && !error ? (
        <img src={url} alt={alt} />
      ) : (
        <span className="attach-img--pending">
          {loading ? 'Loading…' : (error ? 'Preview unavailable' : alt)}
        </span>
      )}
      {children}
    </button>
  );
}
