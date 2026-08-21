'use client';

import { useState } from 'react';
import {
  STAGES, LANES, stageIndex, stageLabel, laneOf, legalDestinations, canTransition,
} from '@pms/shared';
import RemarkDialog from '../remark-dialog.jsx';

// ponytail: short names so ten segments fit the drawer; full label stays in .sr
const STAGE_SHORT = {
  pending: 'Pending',
  under_review: 'Review',
  in_progress: 'In Progress',
  ready_local: 'Local',
  ready_qa: 'Ready QA',
  deployed_staging: 'Staging',
  qa_approved: 'QA Approved',
  ready_production: 'Ready Prod',
  live: 'Live',
  closed: 'Closed',
};

function capRole(role) {
  if (!role) return 'Member';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function ticketRelationships(actor, ticket) {
  const actorId = String(actor?.id || actor?._id || '');
  if (!actorId) return [];
  const rels = [];
  if (actorId === String(ticket.assignedTo?.id || ticket.assignedTo?._id || '')) rels.push('assignee');
  if (actorId === String(ticket.createdBy?.id || ticket.createdBy?._id || '')) rels.push('reporter');
  return rels;
}

function listRelationships(rels) {
  if (rels.length === 0) return '';
  if (rels.length === 1) return `the ${rels[0]}`;
  return `the ${rels.slice(0, -1).join(', ')} and the ${rels.at(-1)}`;
}

export default function TicketStageBar({ ticket, actor, onTransition }) {
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const currentIndex = stageIndex(ticket.status);
  const rels = ticketRelationships(actor, ticket);
  const destinations = onTransition ? legalDestinations(ticket.status, actor, ticket) : [];

  function choose(to) {
    const verdict = canTransition(ticket.status, to, actor, ticket);
    if (verdict.isReopen || verdict.isClose) {
      setPending({ to, kind: verdict.isReopen ? 'note' : 'reason' });
      setText('');
      return;
    }
    onTransition({ to, revision: ticket.revision });
  }

  async function confirm() {
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
      <div className="stageline">
        <ul className="railboard" aria-label="Stage pipeline">
          {STAGES.map((stage, i) => {
            const isCurrent = stage.key === ticket.status;
            const canSet = !isCurrent && destinations.includes(stage.key);
            const prevLane = i > 0 ? laneOf(STAGES[i - 1].key) : null;
            const cls = [
              'railseg',
              i > 0 && laneOf(stage.key) !== prevLane ? 'lane-start' : '',
              i > currentIndex && !canSet ? 'locked' : '',
              i < currentIndex ? 'done' : '',
              isCurrent ? 'now' : '',
              canSet ? 'open' : '',
            ].filter(Boolean).join(' ');
            const laneLabel = LANES.find((l) => l.stages.includes(stage.key))?.label || '';

            return (
              <li key={stage.key} className={cls} aria-current={isCurrent ? 'step' : undefined}>
                <button
                  type="button"
                  className="railhit"
                  disabled={!canSet}
                  title={`${laneLabel} · ${stageLabel(stage.key)}${canSet ? ' — click to move here' : ''}`}
                  onClick={() => choose(stage.key)}
                >
                  <span className="bar" />
                  <span className="nm" aria-hidden="true">{STAGE_SHORT[stage.key] || stage.label}</span>
                  <span className="sr">{stageLabel(stage.key)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="stagenow"><b>{stageLabel(ticket.status)}</b></p>
      </div>

      <div className="railkey">
        <span><i className="k-done" />Passed</span>
        <span><i className="k-now" />Now</span>
        <span><i className="k-lock" />You can&apos;t set this</span>
        <span className="k-you">
          You are {capRole(actor?.role)}
          {rels.length > 0 && ` and ${listRelationships(rels)}`} on this ticket
        </span>
      </div>

      <RemarkDialog
        open={Boolean(pending)}
        title={`${pending?.kind === 'note' ? 'Reopen' : 'Close'} ${ticket.ticketId}`}
        label={pending?.kind === 'note' ? 'Note (required to reopen)' : 'Reason (required to close)'}
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
