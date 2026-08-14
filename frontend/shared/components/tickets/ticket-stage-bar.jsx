'use client';

import { useState } from 'react';
import {
  STAGES, LANES, stageIndex, stageLabel, laneOf, legalDestinations, canTransition,
} from '@pms/shared';
import RemarkDialog from '../remark-dialog.jsx';

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
  const destinations = legalDestinations(ticket.status, actor, ticket);
  const rels = ticketRelationships(actor, ticket);

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
      <p className="stagenow">
        Stage {currentIndex + 1} of {STAGES.length}
        {' · '}
        <b>{stageLabel(ticket.status)}</b>
        {ticket.blocked && (
          <>
            {', '}
            <span style={{ color: 'var(--alarm)' }}>blocked</span>
          </>
        )}
      </p>

      <div className="lanebar" aria-hidden="true">
        {LANES.map((lane, li) => (
          <span
            key={lane.key}
            className={li ? 'lane-start' : ''}
            style={{ flex: `${lane.stages.length} 1 0` }}
          >
            {lane.label}
          </span>
        ))}
      </div>

      <div className="railboard" role="list" aria-label="Stage pipeline">
        {STAGES.map((stage, i) => {
          const isCurrent = stage.key === ticket.status;
          const canSet = destinations.includes(stage.key);
          const prevLane = i > 0 ? laneOf(STAGES[i - 1].key) : null;
          const cls = [
            'railseg',
            i > 0 && laneOf(stage.key) !== prevLane ? 'lane-start' : '',
            i < currentIndex ? 'done' : '',
            isCurrent ? 'now' : '',
            i > currentIndex && canSet ? 'open' : '',
            i > currentIndex && !canSet ? 'locked' : '',
            i < currentIndex && canSet ? 'open' : '',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={stage.key}
              type="button"
              role="listitem"
              className={cls}
              disabled={!canSet || isCurrent}
              title={stageLabel(stage.key)}
              aria-label={isCurrent ? 'Current stage' : stageLabel(stage.key)}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => choose(stage.key)}
            >
              <span className="bar" />
              <span className="nm">{STAGE_SHORT[stage.key] || stage.label}</span>
            </button>
          );
        })}
      </div>

      <div className="railkey">
        <span><i style={{ background: 'var(--sig-line)' }} />Passed</span>
        <span><i style={{ background: 'var(--sig)' }} />Now</span>
        <span>
          <i
            style={{
              background: 'repeating-linear-gradient(135deg, var(--rule) 0 2px, transparent 2px 4px)',
              boxShadow: 'inset 0 0 0 1px var(--rule)',
            }}
          />
          You can&apos;t set this
        </span>
        <span style={{ marginLeft: 'auto' }}>
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
