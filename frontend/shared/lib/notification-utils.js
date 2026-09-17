/** Lucide icon names from shared/components/icons.jsx */
const NOTIFICATION_EVENT_ICONS = {
  TICKET_CREATED: 'plus',
  TICKET_ASSIGNED: 'user',
  TICKET_STAGE_CHANGED: 'sliders',
  TICKET_REOPENED: 'back',
  TICKET_CLOSED: 'lock',
  TICKET_COMMENTED: 'msg',
  TICKET_MENTIONED: 'user',
  TICKET_ESTIMATE_SET: 'chart',
};

const NOTIFICATION_SHORT_ACTIONS = {
  TICKET_CREATED: 'Filed',
  TICKET_ASSIGNED: 'Assigned',
  TICKET_STAGE_CHANGED: 'Stage changed',
  TICKET_REOPENED: 'Reopened',
  TICKET_CLOSED: 'Closed',
  TICKET_COMMENTED: 'New comment',
  TICKET_MENTIONED: 'Mentioned',
  TICKET_ESTIMATE_SET: 'Estimates updated',
};

/** Design-system modifier classes for event chips (icon + label, not color-only). */
const NOTIFICATION_EVENT_CHIP_CLASS = {
  TICKET_CREATED: 'notif-chip--neutral',
  TICKET_ASSIGNED: 'notif-chip--sig',
  TICKET_STAGE_CHANGED: 'notif-chip--neutral',
  TICKET_REOPENED: 'notif-chip--warn',
  TICKET_CLOSED: 'notif-chip--neutral',
  TICKET_COMMENTED: 'notif-chip--neutral',
  TICKET_MENTIONED: 'notif-chip--sig',
  TICKET_ESTIMATE_SET: 'notif-chip--warn',
};

export function notificationEventIconName(event) {
  return NOTIFICATION_EVENT_ICONS[event] ?? 'bell';
}

export function notificationEventChipClass(event) {
  return NOTIFICATION_EVENT_CHIP_CLASS[event] ?? 'notif-chip--neutral';
}

export function notificationShortAction(event) {
  return NOTIFICATION_SHORT_ACTIONS[event] ?? 'Update';
}

const SHORT_ACTION_TO_EVENT = Object.freeze(
  Object.fromEntries(
    Object.entries(NOTIFICATION_SHORT_ACTIONS).map(([eventKey, label]) => [label, eventKey]),
  ),
);

/** Prefer the action encoded in `title` ("WEB-1 · Stage changed") when present. */
export function notificationEffectiveEvent(item) {
  const title = item?.title?.trim();
  if (title?.includes(' · ')) {
    const actionLabel = title.split(' · ').slice(1).join(' · ').trim();
    const fromTitle = SHORT_ACTION_TO_EVENT[actionLabel];
    if (fromTitle) return fromTitle;
  }
  return item?.event;
}

/** Strip origin so Next.js Link can navigate in-app. */
export function notificationHref(link) {
  if (!link) return '/notifications';
  try {
    const url = new URL(link);
    return `${url.pathname}${url.search}`;
  } catch {
    return link.startsWith('/') ? link : '/notifications';
  }
}

export function notificationTicketKey(item) {
  if (item?.ticket?.ticketId) return item.ticket.ticketId;
  const link = item?.link ?? '';
  try {
    const url = new URL(link, 'http://local');
    const fromQuery = url.searchParams.get('ticket');
    if (fromQuery) return fromQuery;
  } catch {
    const match = String(link).match(/[?&]ticket=([^&]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

/**
 * Primary line: ticket key + short action. Parses backend titles like "WEB-1 · Assigned".
 */
/**
 * @param {{ omitTicketKey?: boolean }} [options] — action-only line when grouped under a ticket header
 */
export function notificationPrimaryLine(item, options = {}) {
  const { omitTicketKey = false } = options;
  const title = item?.title?.trim();
  const action = notificationShortAction(notificationEffectiveEvent(item));

  if (title?.includes(' · ')) {
    if (omitTicketKey) {
      const rest = title.split(' · ').slice(1).join(' · ').trim();
      return rest || action;
    }
    return title;
  }

  const key = notificationTicketKey(item);
  if (omitTicketKey) return action;
  if (key) return `${key} · ${action}`;
  return title || action;
}

export function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const deltaSec = Math.round((Date.now() - then) / 1000);
  if (deltaSec < 60) return 'just now';

  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Group inbox page results by ticket key (within current page). */
export function groupNotificationsByTicket(items) {
  const groups = new Map();
  const order = [];

  for (const item of items) {
    const ticketKey = notificationTicketKey(item);
    const groupKey = ticketKey ?? `id:${item.id}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { ticketKey, items: [] });
      order.push(groupKey);
    }
    groups.get(groupKey).items.push(item);
  }

  return order.map((key) => {
    const group = groups.get(key);
    const sorted = [...group.items].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
    return { ticketKey: group.ticketKey, items: sorted, latest: sorted[0] };
  });
}

/**
 * Bell dropdown: at most one row per ticket (latest by createdAt).
 * Input should already be sorted newest-first.
 */
export function bellNotificationRows(items) {
  const byKey = new Map();
  const order = [];

  for (const item of items) {
    const ticketKey = notificationTicketKey(item);
    const mapKey = ticketKey ?? item.id;
    if (!byKey.has(mapKey)) {
      byKey.set(mapKey, { latest: item, hidden: 0, ticketKey });
      order.push(mapKey);
    } else {
      byKey.get(mapKey).hidden += 1;
    }
  }

  return order.map((key) => byKey.get(key));
}

export const NOTIFICATION_GROUP_DEFAULT_VISIBLE = 3;

const SUBJECT_BODY_MAX = 120;

export function truncateNotificationText(text, max = SUBJECT_BODY_MAX) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Ticket subject for grouped inbox cards: populated ticket title, else first body in group.
 */
export function ticketSubjectFromGroup(group) {
  const items = group?.items ?? [];
  for (const item of items) {
    const title = item?.ticket?.title?.trim();
    if (title) return title;
  }
  for (const item of items) {
    const body = item?.body?.trim();
    if (body) return truncateNotificationText(body);
  }
  return null;
}

/** Secondary line under each update (event-specific body; not a repeat of ticket subject). */
export function notificationUpdateDescription(item) {
  const body = item?.body?.trim();
  if (!body) return null;

  const ticketTitle = item?.ticket?.title?.trim();
  if (ticketTitle && body === ticketTitle) return null;

  const title = item?.title?.trim();
  if (title?.includes(' · ')) {
    const actionLabel = title.split(' · ').slice(1).join(' · ').trim();
    if (body === actionLabel) return null;
  }

  return body;
}

/**
 * @param {boolean} expanded — show all updates in the group
 */
export function visibleUpdates(items, expanded, maxVisible = NOTIFICATION_GROUP_DEFAULT_VISIBLE) {
  if (!items?.length) return { visible: [], hiddenCount: 0 };
  if (expanded || items.length <= maxVisible) {
    return { visible: items, hiddenCount: 0 };
  }
  return {
    visible: items.slice(0, maxVisible),
    hiddenCount: items.length - maxVisible,
  };
}

export function notificationGroupHref(group) {
  const item = group?.latest ?? group?.items?.[0];
  return item ? notificationHref(item.link) : '/notifications';
}

export function groupHasUnread(items) {
  return items.some((item) => !item.readAt);
}

/** Footer hint when bell rows collapse duplicates. */
export function bellHiddenSummary(rows) {
  let totalHidden = 0;
  const perTicket = [];

  for (const row of rows) {
    if (row.hidden > 0) {
      totalHidden += row.hidden;
      if (row.ticketKey) perTicket.push({ ticketKey: row.ticketKey, count: row.hidden });
    }
  }

  if (totalHidden === 0) return null;

  if (perTicket.length === 1) {
    const { ticketKey, count } = perTicket[0];
    return `+${count} more for ${ticketKey}`;
  }

  return `+${totalHidden} more notifications`;
}
