'use client';

import { useState } from 'react';
import {
  STAGES, stageIndex, stageLabel, canTransition, REOPEN_MIN_INDEX,
} from '@pms/shared';
import Icon from '../icons.jsx';
import RemarkDialog from '../remark-dialog.jsx';

function nextForwardStage(ticket, actor) {
  const currentIdx = stageIndex(ticket.status);
  for (let i = currentIdx + 1; i < STAGES.length; i += 1) {
    const key = STAGES[i].key;
    const verdict = canTransition(ticket.status, key, actor, ticket);
    if (verdict.ok && !verdict.isClose) {
      return { to: key, label: stageLabel(key), verdict };
    }
  }
  return null;
}

function noMoveReason(ticket, actor) {
  const currentIdx = stageIndex(ticket.status);
  const nextIdx = Math.min(currentIdx + 1, STAGES.length - 1);
  const nextKey = STAGES[nextIdx].key;
  const verdict = canTransition(ticket.status, nextKey, actor, ticket);
  return verdict.reason || 'This ticket is at the end of the pipeline.';
}

export default function TicketDrawerFooter({ ticket, actor, onTransition }) {
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const forward = nextForwardStage(ticket, actor);
  const currentIdx = stageIndex(ticket.status);
  const canReopen = currentIdx >= REOPEN_MIN_INDEX
    && canTransition(ticket.status, 'in_progress', actor, ticket).ok;
  const canClose = ticket.status !== 'closed'
    && canTransition(ticket.status, 'closed', actor, ticket).ok;

  function requestTransition(to, verdict) {
    if (verdict?.isReopen || verdict?.isClose) {
      setPending({ to, kind: verdict.isReopen ? 'note' : 'reason' });
      setText('');
      return;
    }
    onTransition({ to, revision: ticket.revision });
  }

  async function confirmPending() {
    setBusy(true);
    try {
      await onTransition({
        to: pending.to,
        revision: ticket.revision,
        [pending.kind]: text.trim(),
      });
      setPending(null);
      setText('');
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
            {noMoveReason(ticket, actor)}
          </span>
        )}
        <span className="spacer" />
        {canReopen && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => requestTransition(
              'in_progress',
              canTransition(ticket.status, 'in_progress', actor, ticket),
            )}
          >
            <Icon name="back" size={12} />
            {' '}
            Reopen
          </button>
        )}
        {canClose && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => requestTransition(
              'closed',
              canTransition(ticket.status, 'closed', actor, ticket),
            )}
          >
            Close
          </button>
        )}
      </div>

      <RemarkDialog
        open={Boolean(pending)}
        title={`${pending?.kind === 'note' ? 'Reopen' : 'Close'} ${ticket.ticketId}`}
        label={pending?.kind === 'note' ? 'Note (required to reopen)' : 'Reason (required to close)'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        busy={busy}
        onConfirm={confirmPending}
        onCancel={() => {
          if (busy) return;
          setPending(null);
          setText('');
        }}
      />
    </>
  );
}
