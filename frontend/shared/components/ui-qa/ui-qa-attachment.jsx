'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveUiQaAttachmentDownloadUrl } from '@/shared/api/ui-qa.js';

export function useUiQaAttachmentDownloadUrl(projectId, attachmentId, entity) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(Boolean(attachmentId));
  const [error, setError] = useState(null);
  const entityKey = entity ? JSON.stringify(entity) : '';
  const parsedEntity = useMemo(() => {
    if (!entityKey) return null;
    try {
      return JSON.parse(entityKey);
    } catch {
      return null;
    }
  }, [entityKey]);

  useEffect(() => {
    if (!projectId || !attachmentId || !parsedEntity) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    resolveUiQaAttachmentDownloadUrl(projectId, attachmentId, parsedEntity)
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
  }, [projectId, attachmentId, parsedEntity]);

  const open = useCallback(async () => {
    if (!parsedEntity) return;
    const target = url ?? await resolveUiQaAttachmentDownloadUrl(projectId, attachmentId, parsedEntity);
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [url, projectId, attachmentId, parsedEntity]);

  const download = useCallback(async () => {
    if (!parsedEntity) return;
    const target = url ?? await resolveUiQaAttachmentDownloadUrl(projectId, attachmentId, parsedEntity);
    const anchor = document.createElement('a');
    anchor.href = target;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
  }, [url, projectId, attachmentId, parsedEntity]);

  return { url, loading, error, open, download };
}

export function UiQaAttachmentLink({
  projectId,
  attachmentId,
  entity,
  children,
  className,
  action = 'open',
  ticketId: _ticketId,
  ...props
}) {
  const { loading, error, open, download } = useUiQaAttachmentDownloadUrl(
    projectId,
    attachmentId,
    entity,
  );

  const onClick = () => {
    const run = action === 'download' ? download : open;
    run().catch(() => {});
  };

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={loading || Boolean(error)}
      aria-busy={loading}
      {...props}
    >
      {children}
    </button>
  );
}

export function UiQaAttachmentImage({
  projectId,
  attachmentId,
  entity,
  alt,
  className,
  children,
  onError,
  ticketId: _ticketId,
}) {
  const { url, loading, error, open } = useUiQaAttachmentDownloadUrl(
    projectId,
    attachmentId,
    entity,
  );

  return (
    <button
      type="button"
      className={className}
      onClick={() => { open().catch(() => {}); }}
      disabled={loading || Boolean(error)}
      aria-busy={loading}
    >
      {url && !error ? (
        <img src={url} alt={alt} onError={onError} />
      ) : (
        <span className="attach-img--pending">
          {loading ? 'Loading…' : (error ? 'Preview unavailable' : alt)}
        </span>
      )}
      {children}
    </button>
  );
}
