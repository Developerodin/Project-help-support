'use client';

import { useState } from 'react';
import {
  QA_STATUSES,
  QA_STATUS_LABELS,
  canTransitionQaStatus,
  isQaReopen,
  legalQaDestinations,
  qaStatusIndex,
} from '@pms/shared';
import RemarkDialog from '@/shared/components/remark-dialog.jsx';

const STAGE_SHORT = {
  open: 'Open',
  review: 'Review',
  in_progress: 'Progress',
  done: 'Done',
};

export default function UiQaStageBar({
  status = 'open',
  onTransition,
}) {
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const currentIndex = qaStatusIndex(status);
  const destinations = onTransition ? legalQaDestinations(status) : [];

  function choose(to) {
    if (to === status || !canTransitionQaStatus(status, to)) return;
    if (isQaReopen(status, to)) {
      setPending({ to });
      setText('');
      return;
    }
    onTransition({ status: to });
  }

  async function confirm() {
    if (!pending) return;
    if (pending.to === status || !canTransitionQaStatus(status, pending.to)) {
      setPending(null);
      setText('');
      return;
    }
    setBusy(true);
    try {
      await onTransition({
        status: pending.to,
        note: text.trim() || undefined,
      });
      setPending(null);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stageline">
        <ul className="railboard" aria-label="QA status pipeline">
          {QA_STATUSES.map((stage, i) => {
            const isCurrent = stage === status;
            const canSet = !isCurrent && destinations.includes(stage);
            const cls = [
              'railseg',
              i > currentIndex && !canSet ? 'locked' : '',
              i < currentIndex ? 'done' : '',
              isCurrent ? 'now' : '',
              canSet ? 'open' : '',
            ].filter(Boolean).join(' ');

            return (
              <li key={stage} className={cls} aria-current={isCurrent ? 'step' : undefined}>
                <button
                  type="button"
                  className="railhit"
                  disabled={!canSet || busy}
                  title={`${QA_STATUS_LABELS[stage]}${canSet ? ' — click to move here' : ''}`}
                  onClick={() => choose(stage)}
                >
                  <span className="bar" />
                  <span className="nm" aria-hidden="true">{STAGE_SHORT[stage] || QA_STATUS_LABELS[stage]}</span>
                  <span className="sr">{QA_STATUS_LABELS[stage]}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="stagenow"><b>{QA_STATUS_LABELS[status] || status}</b></p>
      </div>

      <div className="railkey">
        <span><i className="k-done" />Passed</span>
        <span><i className="k-now" />Now</span>
        <span><i className="k-lock" />You can&apos;t set this</span>
      </div>

      <RemarkDialog
        open={Boolean(pending)}
        title="Reopen QA review"
        label="Note (optional)"
        confirmLabel="Reopen"
        value={text}
        onChange={(event) => setText(event.target.value)}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => {
          if (busy) return;
          setPending(null);
          setText('');
        }}
      />
    </>
  );
}
