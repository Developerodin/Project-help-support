'use client';

import { useState } from 'react';
import {
  STAGES, stageIndex, stageLabel, canTransition, REOPEN_MIN_INDEX, isQaRejection,
  buildBoardRolePolicy,
} from '@pms/shared';
import Icon from '../icons.jsx';
import RemarkDialog from '../remark-dialog.jsx';

function nextForwardStage(ticket, actor, boardPolicy, permissionContext) {
  const currentIdx = stageIndex(ticket.status);
  for (let i = currentIdx + 1; i < STAGES.length; i += 1) {
    const key = STAGES[i].key;
    const verdict = canTransition(ticket.status, key, actor, ticket, boardPolicy, permissionContext);
    if (verdict.ok && !verdict.isClose) {
      return { to: key, label: stageLabel(key), verdict };
    }
  }
  return null;
}

function noMoveReason(ticket, actor, boardPolicy, permissionContext) {
  const currentIdx = stageIndex(ticket.status);
  const nextIdx = Math.min(currentIdx + 1, STAGES.length - 1);
  const nextKey = STAGES[nextIdx].key;
  const verdict = canTransition(ticket.status, nextKey, actor, ticket, boardPolicy, permissionContext);
  return verdict.reason || 'This ticket is at the end of the pipeline.';
}

export default function TicketDrawerFooter({
  ticket,
  actor,
  onTransition,
  boardPolicy = buildBoardRolePolicy(),
  permissionContext = null,
}) {
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);

  // Backward out of the QA lane is a rejection, not a reopen — nothing was
  // closed. Same transition, same permission gate, different words and a
  // required QA report.
  const rejecting = isQaRejection(ticket.status);
  const backLabel = rejecting ? 'Reject' : 'Reopen';

  const forward = nextForwardStage(ticket, actor, boardPolicy, permissionContext);
  const currentIdx = stageIndex(ticket.status);
  const canReopen = currentIdx >= REOPEN_MIN_INDEX
    && canTransition(
      ticket.status, 'in_progress', actor, ticket, boardPolicy, permissionContext,
    ).ok;
  const canClose = ticket.status !== 'closed'
    && canTransition(
      ticket.status, 'closed', actor, ticket, boardPolicy, permissionContext,
    ).ok;

  function requestTransition(to, verdict) {
    if (verdict?.isReopen || verdict?.isClose) {
      setPending({ to, kind: verdict.isReopen ? 'note' : 'reason' });
      setText('');
      setImage(null);
      return;
    }
    onTransition({ to, revision: ticket.revision });
  }

  function closePending() {
    setPending(null);
    setText('');
    setImage(null);
  }

  async function confirmPending() {
    setBusy(true);
    try {
      await onTransition({
        to: pending.to,
        revision: ticket.revision,
        [pending.kind]: text.trim(),
        // The drawer uploads it first and links the resulting id — the
        // transition endpoint takes ids, not files.
        image: pending.kind === 'note' ? image : null,
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
            onClick={() => requestTransition(forward.to, forward.verdict)}
          >
            Move to {forward.label}
          </button>
        ) : (
          <span className="nomove">
            <Icon name="alert" size={13} />
            {noMoveReason(ticket, actor, boardPolicy, permissionContext)}
          </span>
        )}
        <span className="spacer" />
        {canReopen && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => requestTransition(
              'in_progress',
              canTransition(
                ticket.status, 'in_progress', actor, ticket, boardPolicy, permissionContext,
              ),
            )}
          >
            <Icon name="back" size={12} />
            {' '}
            {backLabel}
          </button>
        )}
        {canClose && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => requestTransition(
              'closed',
              canTransition(
                ticket.status, 'closed', actor, ticket, boardPolicy, permissionContext,
              ),
            )}
          >
            Close
          </button>
        )}
      </div>

      <RemarkDialog
        open={Boolean(pending)}
        title={`${pending?.kind === 'note' ? backLabel : 'Close'} ${ticket.ticketId}`}
        label={pending?.kind === 'note'
          ? `${rejecting ? 'QA report' : 'Note'} (required to ${backLabel.toLowerCase()})`
          : 'Reason (required to close)'}
        hint={pending?.kind === 'note' && rejecting
          ? 'What failed, and how to reproduce it. Internal team only — the client never sees this.'
          : undefined}
        confirmLabel={pending?.kind === 'note' ? backLabel : 'Close'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        image={image}
        onImageChange={pending?.kind === 'note' ? setImage : undefined}
        imageLabel={rejecting ? 'Attach a screenshot (optional)' : 'Attach an image (optional)'}
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
