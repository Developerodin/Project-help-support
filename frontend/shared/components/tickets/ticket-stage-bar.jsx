'use client';

import { useState } from 'react';
import { STAGES, stageIndex, stageLabel, legalDestinations } from '@pms/shared';

/**
 * The menu is rendered from shared/stages.js, so it can only ever offer what
 * the server would accept. It is a UX affordance, never a gate — the server
 * re-runs canTransition on every one of these.
 */
export default function TicketStageBar({ ticket, actor, onTransition }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');

  const currentIndex = stageIndex(ticket.status);
  const destinations = legalDestinations(ticket.status, actor, ticket);

  function choose(to) {
    setMenuOpen(false);
    const isReopen = stageIndex(to) < currentIndex;
    const isClose = to === 'closed';

    // Which field is required derives from (from, to) — the same rule the
    // server applies, so the form never asks for the wrong one.
    if (isReopen || isClose) {
      setPending({ to, kind: isReopen ? 'note' : 'reason' });
      setText('');
      return;
    }
    onTransition({ to, revision: ticket.revision });
  }

  function confirm() {
    onTransition({ to: pending.to, revision: ticket.revision, [pending.kind]: text });
    setPending(null);
  }

  return (
    <section>
      <h2>Stage</h2>

      <ol style={{ display: 'flex', gap: 4, listStyle: 'none', padding: 0, flexWrap: 'wrap' }}>
        {STAGES.map((stage) => {
          const isCurrent = stage.key === ticket.status;
          return (
            <li
              key={stage.key}
              aria-label={isCurrent ? 'Current stage' : undefined}
              aria-current={isCurrent ? 'step' : undefined}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background: isCurrent ? 'var(--accent)' : 'transparent',
                color: isCurrent ? '#fff'
                  : (stage.index < currentIndex ? 'var(--fg)' : 'var(--muted)'),
                border: '1px solid var(--border)',
              }}
            >
              {stage.label}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={destinations.length === 0}
      >
        Move to…
      </button>

      {menuOpen && (
        <ul role="menu" style={{ listStyle: 'none', padding: 4, border: '1px solid var(--border)' }}>
          {destinations.map((key) => (
            <li key={key}>
              <button type="button" role="menuitem" onClick={() => choose(key)}>
                {stageLabel(key)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <div>
          <label htmlFor="transition-text">
            {pending.kind === 'note' ? 'Note (required to reopen)' : 'Reason (required to close)'}
          </label>
          <textarea
            id="transition-text" rows={3} style={{ width: '100%' }}
            value={text} onChange={(e) => setText(e.target.value)}
          />
          <button type="button" onClick={confirm} disabled={!text.trim()}>Confirm</button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}
