'use client';

import { useRouter } from 'next/navigation';
import { showToast } from '@/shared/lib/toast.js';
import { ticketFromSearch, withTicketParam } from '@/shared/lib/deep-link.js';
import { mutateNotifications } from '@/shared/lib/notification-swr.js';
import { useRealtimeEvent } from '@/shared/contexts/realtime-context.jsx';

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
    if (event?.type !== 'ticket.comment' || !event.ticketId) return;
    // Your own comment (posted through the assistant): nothing to announce.
    if (event.self) return;

    // The bell row for this comment is already written; pull it now rather than
    // let the badge lag a poll behind the popup.
    mutateNotifications();

    // No popup for the ticket already open on screen — the drawer shows the
    // reply itself, and it gets marked read as you read it.
    if (ticketFromSearch(window.location.search) === event.ticketId) return;

    const from = event.actorName ? ` from ${event.actorName}` : '';
    showToast(`New reply on ${event.ticketId}${from}`, {
      // Announcing a reply you then have to go hunting for is half a feature.
      action: {
        label: 'View',
        onClick: () => router.push(`/tickets${withTicketParam('', event.ticketId)}`),
      },
    });
  });

  return null;
}
