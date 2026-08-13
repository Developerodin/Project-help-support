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