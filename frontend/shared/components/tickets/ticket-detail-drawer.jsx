'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getTicket, patchTicket, transitionTicket, addComment, uploadAttachments,
  watchTicket, unwatchTicket, setBlocked, clearBlocked,
} from '@/shared/api/tickets.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import FormError from '@/shared/components/form-error.jsx';
import TicketHeader from './ticket-header.jsx';
import TicketFields from './ticket-fields.jsx';
import TicketStageBar from './ticket-stage-bar.jsx';
import TicketHistory from './ticket-history.jsx';
import TicketComments from './ticket-comments.jsx';
import TicketAttachments from './ticket-attachments.jsx';

export default function TicketDetailDrawer({ ticketId, onClose, onChanged }) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('discussion');
  const [blockReason, setBlockReason] = useState('');
  const discussionRef = useRef(null);
  const historyRef = useRef(null);

  const selectTab = useCallback((next) => {
    setTab(next);
    requestAnimationFrame(() => {
      (next === 'discussion' ? discussionRef : historyRef).current?.focus();
    });
  }, []);

  const load = useCallback(async () => {
    setTicket(await getTicket(ticketId));
  }, [ticketId]);

  useEffect(() => { load().catch(setError); }, [load]);

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
      setError(err);
      if (err.status === 409) await load();
    }
  };

  const watching = Boolean(
    ticket?.watchers?.some((w) => String(w.id || w._id) === String(user?.id || user?._id)),
  );

  return (
    <>
      <div className={`scrim${ticket ? ' on' : ''}`} onClick={onClose} />
      <aside
        role="dialog"
        aria-label={ticket ? `Ticket ${ticket.ticketId}` : 'Ticket detail'}
        className={`ticket-drawer drawer${ticket ? ' on' : ''}`}
      >
        {!ticket && <div className="drawer-body"><p className="meta">Loading…</p></div>}
        {ticket && (
          <>
            <div className="drawer-head">
              <TicketHeader
                ticket={ticket}
                watching={watching}
                onClose={onClose}
                onToggleWatch={run(() => (watching
                  ? unwatchTicket(ticket.ticketId)
                  : watchTicket(ticket.ticketId)))}
              />
              <FormError error={error} />
              {ticket.blocked && (
                <p className="blocknote">
                  <span>{ticket.blockerReason || 'Blocked'}</span>
                </p>
              )}
              <div className="drawer-rail">
                <h2 className="sr">Stage</h2>
                <TicketStageBar
                  ticket={ticket}
                  actor={user}
                  onTransition={run((body) => transitionTicket(ticket.ticketId, body))}
                />
              </div>
              <div className="tabs" role="tablist" aria-label="Ticket detail">
                <button
                  type="button" className="tab" role="tab" id="tab-discussion"
                  aria-selected={tab === 'discussion'}
                  aria-controls="panel-discussion"
                  onClick={() => selectTab('discussion')}
                >
                  Discussion<span className="n">{ticket.comments?.length || 0}</span>
                </button>
                <button
                  type="button" className="tab" role="tab" id="tab-history"
                  aria-selected={tab === 'history'}
                  aria-controls="panel-history"
                  onClick={() => selectTab('history')}
                >
                  History
                </button>
              </div>
            </div>

            <div className="drawer-body">
              <div className="detail-split">
                <div>
                  <div
                    id="panel-discussion"
                    role="tabpanel"
                    aria-labelledby="tab-discussion"
                    tabIndex={-1}
                    ref={discussionRef}
                    hidden={tab !== 'discussion'}
                  >
                    <TicketComments
                      ticket={ticket}
                      onAdd={run((body) => addComment(ticket.ticketId, body))}
                    />
                    <TicketAttachments
                      ticket={ticket}
                      onUpload={run((form) => uploadAttachments(ticket.ticketId, form))}
                    />
                  </div>
                  <div
                    id="panel-history"
                    role="tabpanel"
                    aria-labelledby="tab-history"
                    tabIndex={-1}
                    ref={historyRef}
                    hidden={tab !== 'history'}
                  >
                    <TicketHistory ticket={ticket} />
                  </div>
                </div>
                <TicketFields
                  ticket={ticket}
                  onSave={run((body) => patchTicket(ticket.ticketId, body))}
                  onBlock={async () => {
                    if (!blockReason.trim()) return;
                    await run(() => setBlocked(ticket.ticketId, {
                      revision: ticket.revision,
                      reason: blockReason,
                    }))();
                    setBlockReason('');
                  }}
                  onUnblock={run(() => clearBlocked(ticket.ticketId, {
                    revision: ticket.revision,
                  }))}
                  blockReason={blockReason}
                  setBlockReason={setBlockReason}
                />
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
