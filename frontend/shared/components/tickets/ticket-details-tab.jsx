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

function TeamValue({ name, locked = false }) {
  return (
    <>
      {name || <EmptyValue>No team</EmptyValue>}
      {locked ? (
        <span className="meta detail-select-hint">Set by project team</span>
      ) : null}
    </>
  );
}

function AssignmentSelect({
  id,
  label,
  emptyLabel,
  value,
  options,
  loading,
  error,
  assigning,
  onChange,
}) {
  return (
    <>
      <select
        id={id}
        className="detail-select"
        aria-label={label}
        value={value}
        disabled={assigning || loading}
        onChange={onChange}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
      {loading ? <span className="meta detail-select-hint">Loading…</span> : null}
      {error ? <span className="field-hint invalid detail-select-hint" role="alert">{error}</span> : null}
    </>
  );
}

export default function TicketDetailsTab({
  ticket,
  canAssign = false,
  canViewTeams = false,
  assignment,
  railPresent = false,
}) {
  const elapsed = ticket.createdAt ? daysBetween(ticket.createdAt) : 0;
  const projectName = ticket.project?.name || ticket.project?.key || ticket.projectKey;
  const editable = canAssign && assignment?.submitAssignment;
  const canEditTeam = editable && canViewTeams && !assignment?.projectTeamLocked;

  const assigneeId = assignment?.assigneeValue?.id || '';
  const teamId = assignment?.teamValue?.id || '';

  async function handleAssigneeChange(event) {
    const next = event.target.value;
    if (next === assigneeId) return;
    try {
      await assignment.submitAssignment(
        'assignee',
        { assignedTo: next || null },
        'Assignee updated',
      );
    } catch {
      event.target.value = assigneeId;
    }
  }

  async function handleTeamChange(event) {
    const next = event.target.value;
    if (next === teamId) return;
    try {
      await assignment.submitAssignment(
        'team',
        { team: next || null },
        'Team assigned',
      );
    } catch {
      event.target.value = teamId;
    }
  }

  return (
    <>
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
        {!railPresent && (
          <DetailField label="Reporter">
            <PersonValue name={ticket.createdBy?.name} empty="—" />
          </DetailField>
        )}
        {!railPresent && (
          <DetailField label="Assignee">
            {editable ? (
              <AssignmentSelect
                id="detail-assignee"
                label="Assignee"
                emptyLabel="Unassigned"
                value={assigneeId}
                options={assignment.userOptions}
                loading={assignment.loadingUsers}
                error={assignment.usersError}
                assigning={assignment.assigningField === 'assignee'}
                onChange={handleAssigneeChange}
              />
            ) : (
              <PersonValue name={ticket.assignedTo?.name} />
            )}
          </DetailField>
        )}
        {!railPresent && (
          <DetailField label="Team">
            {canEditTeam ? (
              <AssignmentSelect
                id="detail-team"
                label="Team"
                emptyLabel="No team"
                value={teamId}
                options={assignment.teamOptions}
                loading={assignment.loadingTeams}
                error={assignment.teamsError}
                assigning={assignment.assigningField === 'team'}
                onChange={handleTeamChange}
              />
            ) : (
              <TeamValue
                name={ticket.team?.name}
                locked={Boolean(assignment?.projectTeamLocked)}
              />
            )}
          </DetailField>
        )}
        {!railPresent && (
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
        )}
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
        {ticket.stepsToReproduce && (
          <DetailField label="Steps to reproduce" wide>
            <p className="detail-prose">{ticket.stepsToReproduce}</p>
          </DetailField>
        )}
      </div>

      {!railPresent && (
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
          <DetailField label="Days open">{elapsed}</DetailField>
          <DetailField label="In current stage">
            <span className="mono">{stageAgeDays(ticket)} days</span>
          </DetailField>
        </div>
      )}
    </>
  );
}

