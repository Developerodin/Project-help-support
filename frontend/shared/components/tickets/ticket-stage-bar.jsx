'use client';

import {
  STAGES, LANES, stageIndex, stageLabel, laneOf,
} from '@pms/shared';

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

export default function TicketStageBar({ ticket, actor }) {
  const currentIndex = stageIndex(ticket.status);
  const rels = ticketRelationships(actor, ticket);

  return (
    <div className="stageline">
      <ul
        className="railboard"
        aria-label="Stage pipeline"
        title={`You are ${capRole(actor?.role)}${rels.length > 0 ? ` and ${listRelationships(rels)}` : ''} on this ticket`}
      >
        {STAGES.map((stage, i) => {
          const isCurrent = stage.key === ticket.status;
          const prevLane = i > 0 ? laneOf(STAGES[i - 1].key) : null;
          const cls = [
            'railseg',
            i > 0 && laneOf(stage.key) !== prevLane ? 'lane-start' : '',
            i < currentIndex ? 'done' : '',
            isCurrent ? 'now' : '',
          ].filter(Boolean).join(' ');

          return (
            <li
              key={stage.key}
              className={cls}
              title={`${LANES.find((l) => l.stages.includes(stage.key))?.label || ''} · ${stageLabel(stage.key)}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="bar" />
              <span className="sr">{stageLabel(stage.key)}</span>
            </li>
          );
        })}
      </ul>
      <p className="stagenow"><b>{stageLabel(ticket.status)}</b></p>
    </div>
  );
}
