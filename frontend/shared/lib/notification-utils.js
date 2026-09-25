import { notificationEventLabel } from '@pms/shared';

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

/**
 * Chip text for a row, or null when the title already says it. Titles are
 * human sentences written by the server and change over time, so they are
 * only compared against, never parsed.
 */
export function notificationChipLabel(item) {
  const label = notificationEventLabel(item?.event);
  if (!item?.event || !label) return null;
  const title = item?.title?.trim().toLowerCase() ?? '';
  return title.includes(label.toLowerCase()) ? null : label;
}

/**
 * Same-origin path so Next.js Link navigates in-app. Stored links are absolute
 * and older rows can name another host, so only path, query and hash are kept.
 */
export function notificationHref(link) {
  if (!link) return '/notifications';
  try {
    const url = new URL(link);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return link.startsWith('/') ? link : '/notifications';
  }
}

/** The populated ticket's ObjectId, for read-all?ticket=. */
export function notificationTicketObjectId(item) {
  const { ticket } = item ?? {};
  if (!ticket) return null;
  if (typeof ticket === 'string') return ticket;
  return ticket.id ?? ticket._id ?? null;
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

/** Primary line: the server's title as written; falls back to ticket key + event label. */
export function notificationPrimaryLine(item) {
  const title = item?.title?.trim();
  if (title) return title;
  const action = notificationEventLabel(item?.event) || 'Update';
  const key = notificationTicketKey(item);
  return key ? `${key} · ${action}` : action;
}

/** When the row last changed: the latest merged update, or creation for older rows. */
export function notificationActivityAt(item) {
  return item?.activityAt ?? item?.createdAt;
}

/** Updates merged into one row by the server; rows from before merging count as 1. */
export function notificationUpdateCount(item) {
  const count = Math.floor(Number(item?.count));
  return count > 1 ? count : 1;
}

export function sumNotificationUpdates(items) {
  return (items ?? []).reduce((sum, item) => sum + notificationUpdateCount(item), 0);
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

/** Full date and time for a `title` tooltip next to a relative time. */
export function formatAbsoluteTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "Today", "Yesterday", or a date, in the viewer's local time zone. */
export function notificationDayLabel(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Inbox ticket groups under day headers, by each group's latest update.
 * Groups arrive newest-first, so consecutive runs share a day.
 */
export function groupsByDay(groups, now = new Date()) {
  const days = [];
  for (const group of groups) {
    const label = notificationDayLabel(notificationActivityAt(group.latest), now);
    const last = days[days.length - 1];
    if (last?.label === label) last.groups.push(group);
    else days.push({ label, groups: [group] });
  }
  return days;
}

/**
 * Group inbox page results by ticket key. Only within the current page: a
 * ticket whose updates straddle a page boundary shows as a card on each page.
 * The server already merges routine updates into one row per ticket; this
 * still gathers a ticket's "for you" row, its merged row and its older, read
 * rows into one card. Card totals sum each row's `count`, not rows.
 */
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
      (a, b) => new Date(notificationActivityAt(b)) - new Date(notificationActivityAt(a)),
    );
    return { ticketKey: group.ticketKey, items: sorted, latest: sorted[0] };
  });
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
  if (body === item?.title?.trim()) return null;

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
