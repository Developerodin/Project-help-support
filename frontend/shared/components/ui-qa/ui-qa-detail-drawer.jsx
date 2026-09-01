'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { getUiQaEntity } from '@/shared/api/ui-qa.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import FormError from '@/shared/components/form-error.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import UiQaEntityWorkspace from './ui-qa-entity-workspace.jsx';
import { sameEntity } from './ui-qa-utils.js';

function nestedDialogOpen(drawerNode) {
  const layers = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  return Array.from(layers).some((el) => el !== drawerNode);
}

/**
 * Ticket-detail drawer shell for a selected UI & QA module/page/screen.
 */
export default function UiQaDetailDrawer({
  projectId,
  selection,
  user,
  onClose,
  onChanged,
}) {
  const { permissionContext } = usePermissionContext();
  const drawerRef = useRef(null);
  const openerRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const entity = selection?.entity;

  const load = useCallback(async () => {
    if (!projectId || !entity) return;
    setError(null);
    try {
      const data = await getUiQaEntity(projectId, entity);
      setDetail(data);
    } catch (err) {
      setDetail(null);
      setError(normalizeApiError(err));
    }
  }, [projectId, entity]);

  useEffect(() => {
    if (!entity) {
      setDetail(null);
      setError(null);
      return;
    }
    load();
  }, [entity, load]);

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [entity?.level, entity?.moduleKey, entity?.pageKey, entity?.screenKey]);

  useEffect(() => {
    if (!detail || !entity) return;
    drawerRef.current?.focus();
  }, [detail, entity]);

  useEffect(() => {
    const node = drawerRef.current;
    if (!entity || !node) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (nestedDialogOpen(node)) return;
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      if (nestedDialogOpen(node)) return;

      const focusables = node.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [entity, onClose]);

  const open = Boolean(entity);
  const title = detail?.title || selection?.title || 'UI & QA detail';
  const ariaLabel = entity ? `${title} review` : 'UI & QA detail';

  const handleUpdated = useCallback(async () => {
    await load();
    await onChanged?.();
  }, [load, onChanged]);

  const stale = detail?.entity && entity && !sameEntity(detail.entity, entity);

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} aria-hidden={!open} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        ref={drawerRef}
        tabIndex={-1}
        className={`ticket-drawer drawer${open ? ' on' : ''}`}
      >
        {!entity ? null : detail && !stale ? (
          <UiQaEntityWorkspace
            projectId={projectId}
            entity={detail.entity}
            title={detail.title}
            breadcrumbs={detail.breadcrumbs || []}
            meta={detail.meta}
            data={detail.data}
            counts={detail.counts}
            user={user}
            permissionContext={permissionContext.loadFailed ? null : permissionContext}
            onUpdated={handleUpdated}
            onClose={onClose}
          />
        ) : (
          <div className="drawer-body">
            {error ? <FormError error={error} /> : <AppLoader inline />}
          </div>
        )}
      </aside>
    </>
  );
}
