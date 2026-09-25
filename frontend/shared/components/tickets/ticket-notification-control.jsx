'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Icon from '../icons.jsx';
import {
  getTicketNotificationSettings,
  updateTicketNotificationSettings,
} from '@/shared/api/notifications.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import { ticketNotificationSettingsKey } from '@/shared/lib/ticket-notification-settings.js';

const sameId = (a, b) => Boolean(a && b) && String(a) === String(b);

/** Why this person hears about the ticket, in the words they'd use. */
function explanation(settings, ticket, user) {
  if (settings.muted) return "Muted: you'll only hear about mentions and assignments.";
  if (settings.inAudienceByRole) {
    const me = user?.id || user?._id;
    if (sameId(ticket.assignedTo?.id || ticket.assignedTo?._id, me)) {
      return "You get updates because you're the assignee.";
    }
    if (sameId(ticket.createdBy?.id || ticket.createdBy?._id, me)) {
      return 'You get updates because you raised this ticket.';
    }
    return 'You get updates because of your role on this ticket.';
  }
  // Following is the drawer's Watch button (same watchers list), so it isn't repeated here.
  return 'Watch this ticket for every update. Mentions and assignments always reach you.';
}

/**
 * Mute for one ticket, as a small menu in the drawer header. Following is the
 * existing Watch button, which writes the same watchers list.
 * Each toggle shows at once and is put back if the server refuses it.
 */
export default function TicketNotificationControl({ ticket, user }) {
  const ticketId = ticket?.id || ticket?._id;
  const key = ticketNotificationSettingsKey(ticketId);
  const { data, mutate } = useSWR(key, () => getTicketNotificationSettings(ticketId), {
    revalidateOnFocus: false,
  });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!data) return null;

  async function toggle(field) {
    const body = { [field]: !data[field] };
    setSaving(true);
    try {
      await mutate(() => updateTicketNotificationSettings(ticketId, body), {
        optimisticData: { ...data, ...body },
        rollbackOnError: true,
        populateCache: true,
        revalidate: false,
      });
    } catch (err) {
      showToast(normalizeApiError(err)?.message || 'Could not change notifications for this ticket', { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const label = data.muted ? 'Muted' : 'Notifications';

  return (
    <div
      className="menuwrap"
      ref={wrapRef}
      onKeyDown={(event) => {
        // Escape closes this menu, not the whole drawer behind it.
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`btn btn-sm${data.muted ? ' chip-on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications for ${ticket.ticketId}: ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={data.muted ? 'volume-off' : 'bell'} size={12} /> {label}
      </button>
      <div className={`menu wide${open ? ' on' : ''}`} role="menu" aria-label={`Notifications for ${ticket.ticketId}`}>
        <p className="menucap meta">{explanation(data, ticket, user)}</p>
        <button
          type="button"
          className="menuitem"
          role="menuitemcheckbox"
          aria-checked={Boolean(data.muted)}
          disabled={saving}
          onClick={() => toggle('muted')}
        >
          <Icon name="volume-off" size={13} /> {data.muted ? 'Muted' : 'Mute'}
          <span className="k">{data.muted ? 'On' : 'Off'}</span>
        </button>
      </div>
    </div>
  );
}
