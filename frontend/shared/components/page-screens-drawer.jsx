'use client';

import { useEffect, useState } from 'react';
import {
  SCREEN_STATUSES,
  SCREEN_STATUS_LABELS,
  SCREEN_TYPES,
  SCREEN_TYPE_LABELS,
} from '@pms/shared';
import Icon from '@/shared/components/icons.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import { newRowId } from '@/shared/lib/project-modules.js';

const EMPTY_SCREEN = {
  name: '',
  type: 'list',
  route: '',
  status: 'active',
  documentation: '',
};

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   moduleLabel: string,
 *   pageLabel: string,
 *   pagePath?: string,
 *   screens: import('@/shared/lib/project-modules.js').ScreenFormRow[],
 *   onChange: (screens: import('@/shared/lib/project-modules.js').ScreenFormRow[]) => void,
 * }} props
 */
export default function PageScreensDrawer({
  open,
  onClose,
  moduleLabel,
  pageLabel,
  pagePath,
  screens = [],
  onChange,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_SCREEN);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraft(EMPTY_SCREEN);
      setDeleteTarget(null);
    }
  }, [open]);

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_SCREEN);
  };

  const startAdd = () => {
    setEditingId('new');
    setDraft({ ...EMPTY_SCREEN });
  };

  const startEdit = (screen) => {
    setEditingId(screen.id);
    setDraft({
      name: screen.name,
      type: screen.type,
      route: screen.route,
      status: screen.status,
      documentation: screen.documentation,
    });
  };

  const saveScreen = () => {
    const next = {
      name: draft.name.trim(),
      type: draft.type || 'other',
      route: (draft.route ?? '').trim(),
      status: draft.status || 'active',
      documentation: (draft.documentation ?? '').trim(),
    };
    if (!next.name) return;

    if (editingId === 'new') {
      onChange([...screens, { id: newRowId(), ...next }]);
    } else {
      onChange(screens.map((screen) => (screen.id === editingId ? { ...screen, ...next } : screen)));
    }
    cancelEdit();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    onChange(screens.filter((screen) => screen.id !== deleteTarget));
    if (editingId === deleteTarget) cancelEdit();
    setDeleteTarget(null);
  };

  const deleteTargetName = screens.find((screen) => screen.id === deleteTarget)?.name;

  return (
    <>
      <div
        className={`scrim${open ? ' on' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-screens-title"
        aria-hidden={!open}
        className={`drawer page-screens-drawer${open ? ' on' : ''}`}
      >
        <header className="drawer-head">
          <div className="drawer-id">
            <span className="id" id="page-screens-title">Screens</span>
            <span className="spacer" />
            <div className="acts">
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
          <p className="page-screens-drawer__intro">
            <span className="page-screens-drawer__breadcrumb">{moduleLabel}</span>
            <span aria-hidden="true"> / </span>
            <span className="page-screens-drawer__page">{pageLabel}</span>
            {pagePath ? (
              <span className="page-screens-drawer__path">{pagePath}</span>
            ) : null}
          </p>
        </header>

        <div className="drawer-body page-screens-drawer__body">
          {screens.length > 0 ? (
            <div className="screen-rows-head" aria-hidden="true">
              <span>Name</span>
              <span>Type</span>
              <span>Route</span>
              <span>Status</span>
              <span />
            </div>
          ) : (
            <p className="page-screens-drawer__empty">No screens yet. Add the first screen for this page.</p>
          )}

          <div className="screen-rows">
            {screens.map((screen) => (
              <div key={screen.id} className="screen-row">
                <span className="screen-row__name">{screen.name}</span>
                <span className="screen-row__type">{SCREEN_TYPE_LABELS[screen.type] ?? screen.type}</span>
                <span className="screen-row__route">{screen.route || '—'}</span>
                <span className={`screen-row__status screen-row__status--${screen.status}`}>
                  {SCREEN_STATUS_LABELS[screen.status] ?? screen.status}
                </span>
                <div className="screen-row__actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => startEdit(screen)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-ico"
                    aria-label={`Remove screen ${screen.name}`}
                    onClick={() => setDeleteTarget(screen.id)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editingId ? (
            <section className="screen-form" aria-label={editingId === 'new' ? 'Add screen' : 'Edit screen'}>
              <h3 className="form-section">{editingId === 'new' ? 'Add screen' : 'Edit screen'}</h3>
              <div className="form-row">
                <label htmlFor="screen-name">Screen name</label>
                <input
                  id="screen-name"
                  type="text"
                  placeholder="e.g. Jobs List"
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="screen-form-grid">
                <div className="form-row">
                  <label htmlFor="screen-type">Type</label>
                  <select
                    id="screen-type"
                    value={draft.type}
                    onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value }))}
                  >
                    {SCREEN_TYPES.map((type) => (
                      <option key={type} value={type}>{SCREEN_TYPE_LABELS[type]}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label htmlFor="screen-status">Status</label>
                  <select
                    id="screen-status"
                    value={draft.status}
                    onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    {SCREEN_STATUSES.map((status) => (
                      <option key={status} value={status}>{SCREEN_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="screen-route">Route</label>
                <input
                  id="screen-route"
                  type="text"
                  placeholder="/ats/jobs (optional)"
                  value={draft.route}
                  onChange={(e) => setDraft((prev) => ({ ...prev, route: e.target.value }))}
                />
              </div>
              <div className="form-row">
                <label htmlFor="screen-documentation">Documentation</label>
                <textarea
                  id="screen-documentation"
                  className="input"
                  rows={3}
                  placeholder="Notes, specs, or attachment references (optional)"
                  value={draft.documentation}
                  onChange={(e) => setDraft((prev) => ({ ...prev, documentation: e.target.value }))}
                />
              </div>
              <div className="screen-form-actions">
                <button type="button" className="btn btn-sm" onClick={cancelEdit}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={saveScreen}
                  disabled={!draft.name.trim()}
                >
                  {editingId === 'new' ? 'Add screen' : 'Save changes'}
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <footer className="drawer-foot">
          {!editingId ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={startAdd}>
              <Icon name="plus" size={12} />
              Add screen
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove screen?"
        message={deleteTargetName ? `Remove "${deleteTargetName}" from this page?` : 'Remove this screen from the page?'}
        confirmLabel="Remove"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
