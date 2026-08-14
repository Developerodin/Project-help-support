'use client';

import { stageLabel } from '@pms/shared';
import { priorityChipClass, priorityLabel, initials } from '../icons.jsx';
import {
  daysBetween, formatDateOnly, formatWhen, stageAgeDays,
} from './ticket-drawer-utils.js';

function DetailField({ label, children, wide = false }) {
  return (
    <div className={`detail-field${wide ? ' wide' : ''}`}>
      <span className="lbl">{label}</span>
      <div className="v">{children}</div>
    </div>
  );
}

function PersonValue({ name, empty = 'Unassigned' }) {
  if (!name) return <span className="empty">{empty}</span>;
  return (
    <span className="personline">
      <span className="avatar sm" title={name}>{initials(name)}</span>
      {name}
    </span>
  );
}

function EmptyValue({ children = 'Not set' }) {
  return <span className="empty">{children}</span>;
}

export default function TicketDetailsTab({ ticket }) {
  const elapsed = ticket.createdAt ? daysBetween(ticket.createdAt) : 0;
  const projectName = ticket.project?.name || ticket.project?.key || ticket.projectKey;

  return (
    <div className="detail-tab">
      <h2 className="sr">Details</h2>

      <div className="detail-fields">
        <DetailField label="Project">
          {projectName || <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Module">
          {ticket.module || <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Page">
          {ticket.page || <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Category">
          {ticket.category || <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Environment">
          {ticket.environment || <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Severity">
          {ticket.severity ? <span className="chip">{ticket.severity}</span> : <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Priority">
          <span className={priorityChipClass(ticket.priority)}>{priorityLabel(ticket.priority)}</span>
        </DetailField>
        <DetailField label="Stage">
          {stageLabel(ticket.status)}
        </DetailField>
        <DetailField label="Reporter">
          <PersonValue name={ticket.createdBy?.name} empty="—" />
        </DetailField>
        <DetailField label="Assignee">
          <PersonValue name={ticket.assignedTo?.name} />
        </DetailField>
        <DetailField label="Team">
          {ticket.team?.name || <EmptyValue>No team</EmptyValue>}
        </DetailField>
        <DetailField label="Created">
          {ticket.createdAt ? (
            <>
              {formatWhen(ticket.createdAt)}
              <span className="meta" style={{ display: 'block', marginTop: 4 }}>
                {elapsed}
                {' days open'}
              </span>
            </>
          ) : (
            <EmptyValue>—</EmptyValue>
          )}
        </DetailField>
        <DetailField label="Updated">
          {ticket.updatedAt ? formatWhen(ticket.updatedAt) : <EmptyValue>—</EmptyValue>}
        </DetailField>
        {ticket.labels?.length > 0 && (
          <DetailField label="Labels" wide>
            <div className="label-chips">
              {ticket.labels.map((label) => (
                <span key={label} className="chip chip-on">{label}</span>
              ))}
            </div>
          </DetailField>
        )}
        {ticket.description && (
          <DetailField label="Description" wide>
            <p className="detail-prose">{ticket.description}</p>
          </DetailField>
        )}
      </div>

      <fieldset className="detail-estimates">
        <legend>Estimates</legend>
        <div className="detail-fields">
          <DetailField label="Resolution estimate">
            {ticket.estimatedResolutionAt
              ? formatDateOnly(ticket.estimatedResolutionAt)
              : <EmptyValue>Not set</EmptyValue>}
          </DetailField>
          <DetailField label="Expected release">
            {ticket.expectedReleaseDate
              ? formatDateOnly(ticket.expectedReleaseDate)
              : <EmptyValue>Not set</EmptyValue>}
          </DetailField>
          <DetailField label="Days open">
            {elapsed}
          </DetailField>
          <DetailField label="In current stage">
            <span className="mono">{stageAgeDays(ticket)} days</span>
          </DetailField>
        </div>
        {!ticket.estimatedResolutionAt && !ticket.expectedReleaseDate && (
          <p className="meta detail-estimates-note">
            Required before In Progress.
          </p>
        )}
      </fieldset>
    </div>
  );
}
