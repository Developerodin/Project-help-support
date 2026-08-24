'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MATRIX_ROLES,
  ROLE_LABELS,
  EXTERNAL_ROLES,
  countRoleGrants,
  setFeatureActionGranted,
} from '@pms/shared';
import AppLoader from '@/shared/components/app-loader.jsx';
import Icon from '@/shared/components/icons.jsx';
import RbacPreviewNav from '@/shared/components/rbac-preview/preview-nav.jsx';
import RolePermissionEditor, { RolePermissionPageHead } from '@/shared/components/rbac-preview/role-permission-editor.jsx';
import BoardPermissionEditor from '@/shared/components/rbac-preview/board-permission-editor.jsx';
import { usePreviewViewState } from '@/shared/lib/rbac-preview/preview-view-state.js';
import {
  cloneRoleMatrix,
  diffMatrixSnapshots,
  recordToMatrixSnapshot,
  snapshotToGrantsRecord,
} from '@/shared/lib/rbac-preview/matrix-utils.js';
import {
  cloneBoardRolePolicy,
  diffBoardSnapshots,
  recordToBoardSnapshot,
  snapshotToBoardGrantsRecord,
} from '@/shared/lib/rbac-preview/board-permissions-utils.js';
import {
  getRoleMatrix,
  resetRoleMatrix,
  updateRoleMatrix,
  getBoardPermissions,
  resetBoardPermissions,
  updateBoardPermissions,
} from '@/shared/api/rbac.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

const MATRIX_MODES = [
  { id: 'view', label: 'View saved' },
  { id: 'edit', label: 'Edit draft' },
];

export default function RbacRoleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const role = decodeURIComponent(String(params.role || ''));
  const { viewMode: demoViewMode, retry: retryDemo } = usePreviewViewState();

  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [matrixMode, setMatrixMode] = useState('view');
  const [matrixBaseline, setMatrixBaseline] = useState(null);
  const [matrixSaved, setMatrixSaved] = useState(null);
  const [matrixDraft, setMatrixDraft] = useState(null);
  const [boardBaseline, setBoardBaseline] = useState(null);
  const [boardSaved, setBoardSaved] = useState(null);
  const [boardDraft, setBoardDraft] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);

  const isKnownRole = MATRIX_ROLES.includes(role);
  const isExternalRole = EXTERNAL_ROLES.includes(role);

  const loadRole = useCallback(async () => {
    if (!isKnownRole) {
      setLoadState('error');
      setLoadError({ message: 'Unknown role.' });
      return;
    }
    setLoadState('loading');
    setLoadError(null);
    try {
      const [matrixData, boardData] = await Promise.all([
        getRoleMatrix(),
        getBoardPermissions(),
      ]);
      const nextMatrixSaved = recordToMatrixSnapshot(matrixData.effective);
      const nextBoardSaved = recordToBoardSnapshot(boardData.effective);
      setMatrixBaseline(recordToMatrixSnapshot(matrixData.baseline));
      setMatrixSaved(nextMatrixSaved);
      setMatrixDraft(cloneRoleMatrix(nextMatrixSaved));
      setBoardBaseline(recordToBoardSnapshot(boardData.baseline));
      setBoardSaved(nextBoardSaved);
      setBoardDraft(cloneBoardRolePolicy(nextBoardSaved));
      setLoadState('data');
    } catch (err) {
      setLoadError(normalizeApiError(err));
      setLoadState('error');
    }
  }, [isKnownRole]);

  const viewMode = demoViewMode !== 'data' ? demoViewMode : loadState;
  const retry = demoViewMode !== 'data' ? retryDemo : loadRole;

  useEffect(() => {
    if (demoViewMode === 'data') loadRole();
  }, [demoViewMode, loadRole]);

  useEffect(() => {
    if (typeof window === 'undefined' || viewMode !== 'data') return;
    if (window.location.hash === '#board-permissions') {
      document.getElementById('board-permissions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [viewMode]);

  useEffect(() => {
    if (!isKnownRole && demoViewMode === 'data') {
      router.replace('/settings/rbac-preview/matrix');
    }
  }, [isKnownRole, demoViewMode, router]);

  const activeMatrix = matrixMode === 'edit' ? matrixDraft : matrixSaved;
  const activeBoard = matrixMode === 'edit' ? boardDraft : boardSaved;

  const matrixChanges = useMemo(
    () => (matrixSaved && matrixDraft ? diffMatrixSnapshots(matrixSaved, matrixDraft) : []),
    [matrixSaved, matrixDraft],
  );
  const boardChanges = useMemo(
    () => (boardSaved && boardDraft ? diffBoardSnapshots(boardSaved, boardDraft) : []),
    [boardSaved, boardDraft],
  );
  const unsavedChanges = useMemo(
    () => [...matrixChanges, ...boardChanges],
    [matrixChanges, boardChanges],
  );

  const grantCount = activeMatrix ? countRoleGrants(activeMatrix, role) : 0;

  const toggleAction = useCallback((featureKey, action, keys, granted) => {
    setMatrixDraft((current) => {
      if (!current) return current;
      const next = cloneRoleMatrix(current);
      setFeatureActionGranted(next, role, keys, granted);
      return next;
    });
    setSaveNotice(null);
  }, [role]);

  const togglePermission = useCallback((permission, granted) => {
    setMatrixDraft((current) => {
      if (!current) return current;
      const next = cloneRoleMatrix(current);
      if (granted) next[role].add(permission);
      else next[role].delete(permission);
      return next;
    });
    setSaveNotice(null);
  }, [role]);

  const toggleBoardCapability = useCallback((board, capability) => {
    setBoardDraft((current) => {
      if (!current) return current;
      const next = cloneBoardRolePolicy(current);
      const caps = next[role][board];
      if (caps.has(capability)) caps.delete(capability);
      else caps.add(capability);
      return next;
    });
    setSaveNotice(null);
  }, [role]);

  async function handleSaveDraft() {
    if (!matrixDraft || !boardDraft) return;
    setSaveBusy(true);
    setSaveNotice(null);
    try {
      const [matrixResult, boardResult] = await Promise.all([
        updateRoleMatrix({ grants: snapshotToGrantsRecord(matrixDraft) }),
        updateBoardPermissions({ grants: snapshotToBoardGrantsRecord(boardDraft) }),
      ]);
      const nextMatrixSaved = recordToMatrixSnapshot(matrixResult.effective);
      const nextBoardSaved = recordToBoardSnapshot(boardResult.effective);
      setMatrixSaved(nextMatrixSaved);
      setMatrixDraft(cloneRoleMatrix(nextMatrixSaved));
      setBoardSaved(nextBoardSaved);
      setBoardDraft(cloneBoardRolePolicy(nextBoardSaved));
      setMatrixMode('view');
      setSaveNotice('Permissions saved.');
      showToast(`${ROLE_LABELS[role] || role} permissions updated`);
    } catch (err) {
      const message = normalizeApiError(err).message;
      setSaveNotice(message);
      showToast(message, { type: 'error' });
    } finally {
      setSaveBusy(false);
    }
  }

  function handleCancelDraft() {
    if (!matrixSaved || !boardSaved) return;
    setMatrixDraft(cloneRoleMatrix(matrixSaved));
    setBoardDraft(cloneBoardRolePolicy(boardSaved));
    setMatrixMode('view');
    setSaveNotice(null);
  }

  function handleResetDraft() {
    if (!matrixBaseline || !boardBaseline) return;
    setMatrixDraft(cloneRoleMatrix(matrixBaseline));
    setBoardDraft(cloneBoardRolePolicy(boardBaseline));
    setSaveNotice(null);
  }

  async function handleResetToCodeBaseline() {
    setSaveBusy(true);
    setSaveNotice(null);
    try {
      const [matrixResult, boardResult] = await Promise.all([
        resetRoleMatrix(),
        resetBoardPermissions(),
      ]);
      const nextMatrixSaved = recordToMatrixSnapshot(matrixResult.effective);
      const nextBoardSaved = recordToBoardSnapshot(boardResult.effective);
      setMatrixSaved(nextMatrixSaved);
      setMatrixDraft(cloneRoleMatrix(nextMatrixSaved));
      setBoardSaved(nextBoardSaved);
      setBoardDraft(cloneBoardRolePolicy(nextBoardSaved));
      setMatrixMode('view');
      setSaveNotice('Reset to code baseline.');
      showToast('Role permissions reset to code baseline');
    } catch (err) {
      showToast(normalizeApiError(err).message, { type: 'error' });
    } finally {
      setSaveBusy(false);
    }
  }

  if (!isKnownRole) return null;

  return (
    <>
      <RolePermissionPageHead role={role} grantCount={grantCount} />
      <RbacPreviewNav />

      {viewMode === 'data' && (
        <div className="rbac-matrix-toolbar" role="group" aria-label="Role editing mode">
          <div className="rbac-matrix-toolbar__modes">
            {MATRIX_MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`btn btn-sm${matrixMode === id ? ' btn-primary' : ''}`}
                aria-pressed={matrixMode === id}
                onClick={() => {
                  if (id === 'edit' && matrixSaved && boardSaved) {
                    setMatrixDraft(cloneRoleMatrix(matrixSaved));
                    setBoardDraft(cloneBoardRolePolicy(boardSaved));
                    setMatrixMode('edit');
                  } else if (id === 'view') {
                    handleCancelDraft();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {matrixMode === 'view' && (
            <>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleResetToCodeBaseline}
                disabled={saveBusy}
              >
                Reset to code baseline
              </button>
            </>
          )}
        </div>
      )}

      {saveNotice && <p className="rbac-matrix-notice" role="status">{saveNotice}</p>}

      {viewMode === 'loading' && (
        <AppLoader inline label="Loading role permissions…" ariaLabel="Loading role permissions" />
      )}

      {viewMode === 'error' && (
        <div className="banner" role="alert">
          <Icon name="alert" size={16} aria-hidden="true" />
          <div>
            <b>Could not load role</b>
            <div>{loadError?.message || 'Permission registry unavailable.'}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={retry}>Retry</button>
        </div>
      )}

      {viewMode === 'data' && matrixMode === 'edit' && unsavedChanges.length > 0 && (
        <div className="rbac-matrix-draft-bar" role="status" aria-live="polite">
          <div className="rbac-matrix-draft-bar__summary">
            <strong>
              {unsavedChanges.length}
              {' '}
              unsaved change
              {unsavedChanges.length === 1 ? '' : 's'}
            </strong>
          </div>
          <div className="rbac-matrix-draft-bar__actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSaveDraft}
              disabled={saveBusy}
            >
              {saveBusy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="btn btn-sm" onClick={handleCancelDraft}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm" onClick={handleResetDraft}>
              Reset draft
            </button>
          </div>
        </div>
      )}

      {viewMode === 'data' && activeMatrix && activeBoard && (
        <>
          <RolePermissionEditor
            role={role}
            snapshot={activeMatrix}
            mode={matrixMode}
            onToggleAction={toggleAction}
            onTogglePermission={togglePermission}
          />
          {!isExternalRole && (
            <BoardPermissionEditor
              role={role}
              snapshot={activeBoard}
              mode={matrixMode}
              onToggleCapability={toggleBoardCapability}
            />
          )}
        </>
      )}
    </>
  );
}
