export const NOTIFICATION_EVENTS = Object.freeze([
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_STAGE_CHANGED',
  'TICKET_REOPENED',
  'TICKET_CLOSED',
  'TICKET_COMMENTED',
  'TICKET_MENTIONED',
  'TICKET_ESTIMATE_SET',
]);

/** Human-readable labels for UI display; API keys stay SCREAMING_SNAKE_CASE. */
export const NOTIFICATION_EVENT_LABELS = Object.freeze({
  TICKET_CREATED: 'New ticket',
  TICKET_ASSIGNED: 'Assigned',
  TICKET_STAGE_CHANGED: 'Stage changed',
  TICKET_REOPENED: 'Reopened',
  TICKET_CLOSED: 'Closed',
  TICKET_COMMENTED: 'New comment',
  TICKET_MENTIONED: 'Mentioned you',
  TICKET_ESTIMATE_SET: 'Dates updated',
});

export function notificationEventLabel(event) {
  return NOTIFICATION_EVENT_LABELS[event] ?? event;
}

/**
 * An unset user preference resolves through this table — never to `true`.
 * Dharwin's tracker has no pref key at all, so `isChannelAllowed` returns true
 * unconditionally and opt-outs are silently ignored. This is the fix.
 *
 * TICKET_COMMENTED and TICKET_ESTIMATE_SET default email OFF because they are
 * the two high-volume events; everything else is worth an inbox interruption.
 */
export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  email: Object.freeze({
    TICKET_CREATED: true,
    TICKET_ASSIGNED: true,
    TICKET_STAGE_CHANGED: true,
    TICKET_REOPENED: true,
    TICKET_CLOSED: true,
    TICKET_COMMENTED: false,
    TICKET_MENTIONED: true,
    TICKET_ESTIMATE_SET: false,
  }),
  inApp: Object.freeze({
    TICKET_CREATED: true,
    TICKET_ASSIGNED: true,
    TICKET_STAGE_CHANGED: true,
    TICKET_REOPENED: true,
    TICKET_CLOSED: true,
    TICKET_COMMENTED: true,
    TICKET_MENTIONED: true,
    TICKET_ESTIMATE_SET: true,
  }),
  // 'immediate' batches routine mail per ticket for a few minutes; 'hourly'
  // and 'daily' hold it for one summary email. Mentions and "assigned to you"
  // are always sent at once, whatever this says.
  emailFrequency: 'immediate',
  // IANA zone the hourly/daily slots and quiet hours are read in. The backend
  // falls back to its DEFAULT_TIME_ZONE when a stored value is missing.
  timeZone: 'Asia/Kolkata',
  // May cross midnight (22:00 -> 08:00). In-app rows are always written;
  // email waits for `end`, routine push is skipped.
  quietHours: Object.freeze({
    enabled: false, start: '22:00', end: '08:00', allowUrgent: true,
  }),
  // Master switch for ticket email. Invite and password-reset mail still go out.
  emailPaused: false,
});

export const EMAIL_FREQUENCIES = Object.freeze(['immediate', 'hourly', 'daily']);
