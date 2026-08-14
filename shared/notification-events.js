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
  TICKET_CREATED: 'Ticket created',
  TICKET_ASSIGNED: 'Ticket assigned',
  TICKET_STAGE_CHANGED: 'Ticket stage changed',
  TICKET_REOPENED: 'Ticket reopened',
  TICKET_CLOSED: 'Ticket closed',
  TICKET_COMMENTED: 'Ticket commented',
  TICKET_MENTIONED: 'Ticket mentioned',
  TICKET_ESTIMATE_SET: 'Ticket estimate set',
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
});
