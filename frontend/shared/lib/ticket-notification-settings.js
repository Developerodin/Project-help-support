import { mutate } from 'swr';
import { updateTicketNotificationSettings } from '@/shared/api/notifications.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

/** SWR key for one ticket's mute/follow state; `ticketId` is the ticket's Mongo id. */
export function ticketNotificationSettingsKey(ticketId) {
  return ticketId ? ['ticket-notification-settings', String(ticketId)] : null;
}

async function setMuted(ticketId, muted) {
  const settings = await updateTicketNotificationSettings(ticketId, { muted });
  // An open drawer for the same ticket shows the new state without refetching.
  await mutate(ticketNotificationSettingsKey(ticketId), settings, { revalidate: false });
  return settings;
}

/** Mute from a notification, with an Undo in the toast. Resolves true when muted. */
export async function muteTicketWithUndo(ticketId, ticketKey) {
  const name = ticketKey || 'this ticket';
  try {
    await setMuted(ticketId, true);
  } catch (err) {
    showToast(normalizeApiError(err)?.message || `Could not mute ${name}`, { type: 'error' });
    return false;
  }
  showToast(`Muted ${name}. You'll still hear about mentions and assignments.`, {
    action: {
      label: 'Undo',
      onClick: () => {
        setMuted(ticketId, false).catch((err) => {
          showToast(normalizeApiError(err)?.message || `Could not unmute ${name}`, { type: 'error' });
        });
      },
    },
  });
  return true;
}
