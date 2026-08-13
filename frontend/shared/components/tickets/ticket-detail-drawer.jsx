'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getTicket, patchTicket, transitionTicket, addComment, uploadAttachments,
} from '@/shared/api/tickets.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import FormError from '@/shared/components/form-error.jsx';
import TicketHeader from './ticket-header.jsx';
import TicketFields from './ticket-fields.jsx';
import TicketStageBar from './ticket-stage-bar.jsx';
import TicketHistory from './ticket-history.jsx';
import TicketComments from './ticket-comments.jsx';
import TicketAttachments from './ticket-attachments.jsx';

/**
 * The SHELL orchestrates; it does not render fields, history or comments
 * itself. That is the whole point of the split — this file stays readable while
 * the six children each do one job.
 */
export default function TicketDetailDrawer({ ticketId, onClose, onChanged }) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setTicket(await getTicket(ticketId));
  }, [ticketId]);

  useEffect(() => { load().catch(setError); }, [load]);

  // Escape closes, like every other drawer in the world.
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (operation) => async (...args) => {
    setError(null);
    try {
      await operation(...args);
      await load();
      onChanged?.();
    } catch (err) {
      // A 409 is not a crash — it means someone else moved first, and the
      // correct response is to show what happened and reload.
      setError(err);
      if (err.status === 409) await load();
    }
  };

  if (error && !ticket) return <FormError error={error} />;
  if (!ticket) return <aside><p>Loading…</p></aside>;

  return (
    <aside
      role="dialog"
      aria-label={`Ticket ${ticket.ticketId}`}
      className="ticket-drawer"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)',
        background: 'var(--bg)', borderLeft: '1px solid var(--border)',
        overflowY: 'auto', padding: 16,
      }}
    >
      <TicketHeader ticket={ticket} onClose={onClose} />
      <FormError error={error} />

      <TicketStageBar
        ticket={ticket}
        actor={user}
        onTransition={run((body) => transitionTicket(ticket.ticketId, body))}
      />
      <TicketFields ticket={ticket} onSave={run((body) => patchTicket(ticket.ticketId, body))} />
      <TicketHistory ticket={ticket} />
      <TicketComments ticket={ticket} onAdd={run((body) => addComment(ticket.ticketId, body))} />
      <TicketAttachments
        ticket={ticket}
        onUpload={run((form) => uploadAttachments(ticket.ticketId, form))}
      />
    </aside>
  );
}
