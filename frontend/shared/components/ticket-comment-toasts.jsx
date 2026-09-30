'use client';

import { useRouter } from 'next/navigation';
import { showToast } from '@/shared/lib/toast.js';
import { ticketFromSearch, withTicketParam } from '@/shared/lib/deep-link.js';
import { mutateNotifications } from '@/shared/lib/notification-swr.js';
import { useRealtimeEvent } from '@/shared/contexts/realtime-context.jsx';

/**
 * Replies per ticket while its popup is up, so a burst on one ticket updates
 * one popup ("3 replies from Asha and Ravi") instead of stacking three. The
 * entry goes when the popup does; the next reply starts a fresh count.
 */
const bursts = new Map();

/** "Asha replied", "3 replies from Asha and Ravi", "5 replies from Asha and 2 others". */
export function replyHeadline(count, names) {
  if (count === 1) return names[0] ? `${names[0]} replied` : 'New reply';
  if (names.length === 0) return `${count} new replies`;
  const who = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
      : `${names[0]} and ${names.length - 1} others`;
  return `${count} replies from ${who}`;
}

/**
 * The app-wide "someone replied" popup. Mounted in the shell so it fires on
 * whatever page you happen to be on, not only the ticket list.
 *
 * The server sends ticket.comment only to the discussion audience — raiser,
 * assigned tester and watchers — so arriving here already means it concerns you.
 */
export default function TicketCommentToasts() {
  const router = useRouter();

  useRealtimeEvent((event) => {
    // A new bell row for you, from any source: refresh the badge and lists now.
    if (event?.type === 'notification.created') {
      mutateNotifications();
      return;
    }
    if (event?.type !== 'ticket.comment' || !event.ticketId) return;
    // Your own comment (posted through the assistant): nothing to announce.
    if (event.self) return;

    // The bell row for this comment is already written; pull it now rather than
    // let the badge lag a poll behind the popup.
    mutateNotifications();

    // No popup for the ticket already open on screen — the drawer shows the
    // reply itself, and it gets marked read as you read it.
    if (ticketFromSearch(window.location.search) === event.ticketId) return;

    const burst = bursts.get(event.ticketId) ?? { count: 0, names: [] };
    burst.count += 1;
    if (event.actorName && !burst.names.includes(event.actorName)) burst.names.push(event.actorName);
    bursts.set(event.ticketId, burst);

    showToast(replyHeadline(burst.count, burst.names), {
      key: `reply:${event.ticketId}`,
      onClose: () => bursts.delete(event.ticketId),
      tag: event.ticketId,
      detail: event.title || null,
      // Something to act on, so it stays up longer than a plain notice.
      durationMs: 8000,
      // Announcing a reply you then have to go hunting for is half a feature.
      action: {
        label: 'Open',
        onClick: () => router.push(`/tickets${withTicketParam('', event.ticketId)}`),
      },
    });
  });

  return null;
}
