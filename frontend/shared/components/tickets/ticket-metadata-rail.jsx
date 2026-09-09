'use client';

import { useEffect, useRef, useState } from 'react';
import { todayDateKey, validateTicketEstimateDates } from '@pms/shared';
import Icon, { initials, isOverdue } from '../icons.jsx';
import TicketRailPicker from './ticket-rail-picker.jsx';
import {
  dateValue, daysBetween, formatWhen, formatDateOnly, stageAgeDays,
} from './ticket-drawer-utils.js';

function PersonLine({ name, empty = 'Unassigned' }) {
  if (!name) return <span className="v empty">{empty}</span>;
  return (
    <span className="personline">
      <span className="avatar sm" title={name}>{initials(name)}</span>
      {name}
    </span>
  );
}

function personKey(person) {
  if (!person) return '';
  if (typeof person === 'string') return person;
  return String(person.id || person._id || person.email || person.name || '');
}

function uniquePeople(...people) {
  const seen = new Set();
  const result = [];
  for (const person of people) {
    if (!person) continue;
    const key = personKey(person);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(person);
  }
  return result;
}

function WatcherAvatar({ name }) {
  return <span className="avatar sm" title={name}>{initials(name)}</span>;
}

export default function TicketMetadataRail({
  ticket, onSave, canAssign = false, canViewTeams = false, canEditEstimates = false, assignment, onBlock, onUnblock, blockReason, setBlockReason,
  fieldErrors = {}, onFieldEdit,
}) {
  const [localDateErrors, setLocalDateErrors] = useState({});
  const [draft, setDraft] = useState({
    estimatedResolutionAt: dateValue(ticket.estimatedResolutionAt),
    expectedReleaseDate: dateValue(ticket.expectedReleaseDate),
  });
  const [saveFeedback, setSaveFeedback] = useState({ state: 'idle', message: '' });
  const saveFeedbackTimerRef = useRef(null);
  const saveInFlightRef = useRef(false);

  const {
    assigneePickerOpen,
    setAssigneePickerOpen,
    teamPickerOpen,
    setTeamPickerOpen,
    userOptions,
    teamOptions,
    loadingUsers,
    loadingTeams,
    usersError,
    teamsError,
    assigningField,
    assigneeValue,
    teamValue,
    submitAssignment,
  } = assignment || {};

  const set = (key) => (event) => {
    onFieldEdit?.(key);
    if (saveFeedback.state !== 'idle') {
      setSaveFeedback({ state: 'idle', message: '' });
      if (saveFeedbackTimerRef.current) {
        window.clearTimeout(saveFeedbackTimerRef.current);
        saveFeedbackTimerRef.current = null;
      }
    }
    setLocalDateErrors((prev) => {
      if (!prev[key] && !prev.expectedReleaseDate) return prev;
      const next = { ...prev };
      delete next[key];
      delete next.expectedReleaseDate;
      return next;
    });
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  };

  useEffect(() => () => {
    if (saveFeedbackTimerRef.current) {
      window.clearTimeout(saveFeedbackTimerRef.current);
    }
  }, []);

  const mergedFieldErrors = { ...fieldErrors, ...localDateErrors };
  const savingDates = saveFeedback.state === 'saving';

  const today = todayDateKey();
  const estIso = draft.estimatedResolutionAt || dateValue(ticket.estimatedResolutionAt);
  const releaseIso = draft.expectedReleaseDate || dateValue(ticket.expectedReleaseDate);
  const releaseMin = estIso && estIso >= today ? estIso : today;

  const saveDates = async (override = {}) => {
    if (saveInFlightRef.current) return;
    const nextDraft = { ...draft, ...override };
    if (Object.keys(override).length) {
      setDraft((prev) => ({ ...prev, ...override }));
    }
    if (saveFeedbackTimerRef.current) {
      window.clearTimeout(saveFeedbackTimerRef.current);
      saveFeedbackTimerRef.current = null;
    }

    const nextResolution = nextDraft.estimatedResolutionAt;
    const nextRelease = nextDraft.expectedReleaseDate;
    const nextResolutionChanged = nextResolution !== dateValue(ticket.estimatedResolutionAt);
    const nextReleaseChanged = nextRelease !== dateValue(ticket.expectedReleaseDate);

    if (!nextResolutionChanged && !nextReleaseChanged) return;

    const changedFields = [];
    const body = { revision: ticket.revision };
    if (nextResolutionChanged) {
      changedFields.push('estimatedResolutionAt');
      body.estimatedResolutionAt = nextResolution || null;
    }
    if (nextReleaseChanged) {
      changedFields.push('expectedReleaseDate');
      body.expectedReleaseDate = nextRelease || null;
    }

    const dateErrors = validateTicketEstimateDates(
      nextResolution || null,
      nextRelease || null,
      { changedFields },
    );
    if (dateErrors) {
      setLocalDateErrors(dateErrors);
      return;
    }

    saveInFlightRef.current = true;
    setSaveFeedback({ state: 'saving', message: 'Saving estimate dates…' });
    setLocalDateErrors({});
    try {
      await onSave(body);
      setSaveFeedback({ state: 'saved', message: 'Estimate dates saved.' });
      saveFeedbackTimerRef.current = window.setTimeout(() => {
        setSaveFeedback({ state: 'idle', message: '' });
        saveFeedbackTimerRef.current = null;
      }, 2500);
    } catch (err) {
      setSaveFeedback({
        state: 'error',
        message: err?.message || 'Could not save estimate dates. Try again.',
      });
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const estInvalid = 'estimatedResolutionAt' in mergedFieldErrors;
  const releaseInvalid = 'expectedReleaseDate' in mergedFieldErrors;
  const late = isOverdue(ticket);
  // Persisted value only: keying this on the draft too swapped the branch mid-edit,
  // unmounting the focused input so its onBlur (the save trigger) never fired.
  const hasEst = Boolean(ticket.estimatedResolutionAt);
  const elapsed = ticket.createdAt ? daysBetween(ticket.createdAt) : 0;
  const span = estIso ? daysBetween(ticket.createdAt, `${estIso}T00:00:00Z`) : 0;
  const pct = span > 0 ? Math.min(100, Math.round((elapsed / span) * 100)) : 0;
  const daysLeft = estIso ? -daysBetween(`${estIso}T00:00:00Z`) : null;
  const allWatchers = uniquePeople(...(ticket.watchers || []));
  const watcherAvatars = allWatchers.slice(0, 2);
  const watcherExtra = Math.max(0, allWatchers.length - 2);
  const canEditAssignment = canAssign && submitAssignment;
  const canEditTeam = canEditAssignment && canViewTeams && !assignment?.projectTeamLocked;

  return (
    <aside
      className="metadata-rail sidecol"
      aria-label="Ticket metadata"
      aria-busy={savingDates}
    >
      <h2 className="sr">Metadata</h2>

      <div className="metadata-rail-body">
        <div className="siderow">
          <span className="lbl">Assignee</span>
          {canEditAssignment ? (
            <TicketRailPicker
              label="Assignee"
              emptyLabel="Unassigned"
              kind="user"
              value={assigneeValue}
              options={userOptions}
              loadingOptions={loadingUsers}
              optionsError={usersError}
              open={assigneePickerOpen}
              onOpenChange={setAssigneePickerOpen}
              assigning={assigningField === 'assignee'}
              searchPlaceholder="Search people…"
              onSelect={(assignedTo) => submitAssignment('assignee', { assignedTo }, 'Assignee updated')}
            />
          ) : (
            <PersonLine name={ticket.assignedTo?.name} />
          )}
        </div>

        <div className="siderow">
          <span className="lbl">Team</span>
          {canEditTeam ? (
            <TicketRailPicker
              label="Team"
              emptyLabel="No team"
              kind="team"
              value={teamValue}
              options={teamOptions}
              loadingOptions={loadingTeams}
              optionsError={teamsError}
              open={teamPickerOpen}
              onOpenChange={setTeamPickerOpen}
              assigning={assigningField === 'team'}
              searchPlaceholder="Search teams…"
              onSelect={(team) => submitAssignment('team', { team }, 'Team assigned')}
            />
          ) : (
            <>
              {ticket.team?.name
                ? <span className="v">{ticket.team.name}</span>
                : <span className="v empty">No team</span>}
              {assignment?.projectTeamLocked ? (
                <p className="meta" style={{ marginTop: 4 }}>Set by project team</p>
              ) : null}
            </>
          )}
        </div>

        <div className="siderow">
          <span className="lbl">Reported by</span>
          <PersonLine name={ticket.createdBy?.name} empty="—" />
          <p className="meta" style={{ marginTop: 4 }}>
            {formatWhen(ticket.createdAt)}
            {' · '}
            {elapsed}
            {' days open'}
          </p>
        </div>

        <div className={`siderow${estInvalid ? ' bad' : ''}`}>
          <span className="lbl">Resolution estimate</span>
          {canEditEstimates ? (
            <>
              <label className="sr" htmlFor="estimatedResolutionAt">Resolution estimate</label>
              {hasEst ? (
                <div className={`due${late ? ' late' : ''}`}>
                  <input
                    id="estimatedResolutionAt"
                    type="date"
                    value={draft.estimatedResolutionAt}
                    min={today}
                    max={releaseIso || undefined}
                    onChange={set('estimatedResolutionAt')}
                    onBlur={(event) => { void saveDates({ estimatedResolutionAt: event.target.value }); }}
                    disabled={savingDates}
                    aria-invalid={estInvalid}
                    aria-describedby={mergedFieldErrors.estimatedResolutionAt ? 'estimatedResolutionAt-hint' : undefined}
                  />
                  <div className="track">
                    <span className="fill" style={{ width: `${late ? 100 : pct}%` }} />
                  </div>
                  <p className="read">
                    {late ? (
                      <>
                        <b>{Math.abs(daysLeft ?? 0)}d late</b>
                        <span>
                          estimate was
                          {' '}
                          {formatWhen(ticket.estimatedResolutionAt || `${draft.estimatedResolutionAt}T00:00:00Z`)}
                        </span>
                      </>
                    ) : (
                      <>
                        <b>{daysLeft ?? 0}d left</b>
                        <span>due {formatWhen(ticket.estimatedResolutionAt || `${draft.estimatedResolutionAt}T00:00:00Z`)}</span>
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <input
                    id="estimatedResolutionAt"
                    type="date"
                    value={draft.estimatedResolutionAt}
                    min={today}
                    max={releaseIso || undefined}
                    onChange={set('estimatedResolutionAt')}
                    onBlur={(event) => { void saveDates({ estimatedResolutionAt: event.target.value }); }}
                    disabled={savingDates}
                    aria-invalid={estInvalid}
                    aria-describedby={mergedFieldErrors.estimatedResolutionAt ? 'estimatedResolutionAt-hint' : undefined}
                  />
                  <span className="v empty">Not set</span>
                </>
              )}
            </>
          ) : hasEst ? (
            <div className={`due${late ? ' late' : ''}`}>
              <span className="v">{formatDateOnly(ticket.estimatedResolutionAt || `${estIso}T00:00:00Z`)}</span>
              <div className="track">
                <span className="fill" style={{ width: `${late ? 100 : pct}%` }} />
              </div>
              <p className="read">
                {late ? (
                  <>
                    <b>{Math.abs(daysLeft ?? 0)}d late</b>
                    <span>
                      estimate was
                      {' '}
                      {formatWhen(ticket.estimatedResolutionAt || `${estIso}T00:00:00Z`)}
                    </span>
                  </>
                ) : (
                  <>
                    <b>{daysLeft ?? 0}d left</b>
                    <span>due {formatWhen(ticket.estimatedResolutionAt || `${estIso}T00:00:00Z`)}</span>
                  </>
                )}
              </p>
            </div>
          ) : (
            <span className="v empty">Not set</span>
          )}
          {mergedFieldErrors.estimatedResolutionAt ? (
            <p id="estimatedResolutionAt-hint" className="field-hint invalid">
              {mergedFieldErrors.estimatedResolutionAt}
            </p>
          ) : null}
        </div>

        <div className={`siderow${releaseInvalid ? ' bad' : ''}`}>
          <span className="lbl">Expected release</span>
          {canEditEstimates ? (
            <>
              <label className="sr" htmlFor="expectedReleaseDate">Expected release</label>
              {ticket.expectedReleaseDate ? (
                <input
                  id="expectedReleaseDate"
                  type="date"
                  value={draft.expectedReleaseDate}
                  min={releaseMin}
                  onChange={set('expectedReleaseDate')}
                  onBlur={(event) => { void saveDates({ expectedReleaseDate: event.target.value }); }}
                  disabled={savingDates}
                  aria-invalid={releaseInvalid}
                  aria-describedby={mergedFieldErrors.expectedReleaseDate ? 'expectedReleaseDate-hint' : undefined}
                />
              ) : (
                <>
                  <input
                    id="expectedReleaseDate"
                    type="date"
                    value={draft.expectedReleaseDate}
                    min={releaseMin}
                    onChange={set('expectedReleaseDate')}
                    onBlur={(event) => { void saveDates({ expectedReleaseDate: event.target.value }); }}
                    disabled={savingDates}
                    aria-invalid={releaseInvalid}
                    aria-describedby={mergedFieldErrors.expectedReleaseDate ? 'expectedReleaseDate-hint' : undefined}
                  />
                  <span className="v empty">Not set</span>
                </>
              )}
            </>
          ) : (
            ticket.expectedReleaseDate || releaseIso
              ? <span className="v">{formatDateOnly(ticket.expectedReleaseDate || `${releaseIso}T00:00:00Z`)}</span>
              : <span className="v empty">Not set</span>
          )}
          {mergedFieldErrors.expectedReleaseDate ? (
            <p id="expectedReleaseDate-hint" className="field-hint invalid">
              {mergedFieldErrors.expectedReleaseDate}
            </p>
          ) : null}
        </div>

        {saveFeedback.state !== 'idle' ? (
          <p
            className={saveFeedback.state === 'error' ? 'field-hint invalid' : 'meta'}
            role={saveFeedback.state === 'error' ? 'alert' : 'status'}
            aria-live={saveFeedback.state === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {saveFeedback.message}
          </p>
        ) : null}

        <div className="siderow">
          <span className="lbl">In current stage</span>
          <span className="v mono">{stageAgeDays(ticket)} days</span>
        </div>

        <div className="siderow">
          <span className="lbl">Watchers</span>
          <div className="teamgrid">
            {watcherAvatars.map((person) => (
              <WatcherAvatar key={personKey(person)} name={person.name} />
            ))}
            {watcherExtra > 0 && <span className="meta">+{watcherExtra} more</span>}
            {!watcherAvatars.length && watcherExtra === 0 && (
              <span className="v empty">None</span>
            )}
          </div>
        </div>

        <div className="siderow">
          <span className="lbl">Blocked</span>
          {ticket.blocked ? (
            <button type="button" className="btn btn-sm" onClick={onUnblock}>Clear blocker</button>
          ) : (
            <>
              <textarea
                rows={2}
                placeholder="Why is this blocked?"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
              />
              <button type="button" className="btn btn-sm" onClick={onBlock} disabled={!blockReason.trim()}>
                Mark blocked
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
