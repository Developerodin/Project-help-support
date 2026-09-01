'use client';

import { useState } from 'react';
import {
  QA_STATUS_LABELS,
  canTransitionQaStatus,
  isQaReopen,
  nextForwardQaStatus,
  nextQaStatusOptions,
} from '@pms/shared';
import Icon from '@/shared/components/icons.jsx';
import RemarkDialog from '@/shared/components/remark-dialog.jsx';

function noMoveReason(status) {
  if (!nextQaStatusOptions(status).length) {
    return 'This item has no further QA transitions.';
  }
  return 'No forward move is available from this status.';
}

export default function UiQaDrawerFooter({
  status = 'open',
  onTransition,
}) {
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const forward = onTransition ? nextForwardQaStatus(status) : null;
  const reopenTargets = (status === 'done' ? nextQaStatusOptions(status) : [])
    .filter((key) => isQaReopen(status, key));
  const canReopen = Boolean(onTransition) && reopenTargets.length > 0;

  async function requestTransition(to) {
    if (!onTransition || busy) return;
    if (to === status || !canTransitionQaStatus(status, to)) return;
    if (isQaReopen(status, to)) {
      setPending({ to });
      setText('');
      return;
    }
    setBusy(true);
    try {
      await onTransition({ status: to });
    } finally {
      setBusy(false);
    }
  }

  function closePending() {
    setPending(null);
    setText('');
  }

  async function confirmPending() {
    if (!onTransition || !pending) return;
    if (pending.to === status || !canTransitionQaStatus(status, pending.to)) {
      closePending();
      return;
    }
    setBusy(true);
    try {
      await onTransition({
        status: pending.to,
        note: text.trim() || undefined,
      });
      closePending();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-foot">
        {forward ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => requestTransition(forward.to)}
          >
            Move to {forward.label}
          </button>
        ) : (
          <span className="nomove">
            <Icon name="alert" size={13} />
            {noMoveReason(status)}
          </span>
        )}
        <span className="spacer" />
        {canReopen ? reopenTargets.map((to) => (
          <button
            key={to}
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => requestTransition(to)}
          >
            <Icon name="back" size={12} />
            {' '}
            Reopen → {QA_STATUS_LABELS[to]}
          </button>
        )) : null}
      </div>

      <RemarkDialog
        open={Boolean(pending)}
        title={`Reopen → ${QA_STATUS_LABELS[pending?.to] || 'Review'}`}
        label="Note (optional)"
        confirmLabel="Reopen"
        value={text}
        onChange={(event) => setText(event.target.value)}
        busy={busy}
        onConfirm={confirmPending}
        onCancel={() => {
          if (busy) return;
          closePending();
        }}
      />
    </>
  );
}
