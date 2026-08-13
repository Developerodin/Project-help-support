'use client';

import { useState } from 'react';
import { STAGES, stageIndex, stageLabel, legalDestinations, canTransition } from '@pms/shared';

export default function TicketStageBar({ ticket, actor, onTransition }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');

  const currentIndex = stageIndex(ticket.status);
  const destinations = legalDestinations(ticket.status, actor, ticket);

  function choose(to) {
    setMenuOpen(false);
    const verdict = canTransition(ticket.status, to, actor, ticket);
    if (verdict.isReopen || verdict.isClose) {
      setPending({ to, kind: verdict.isReopen ? 'note' : 'reason' });
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
    <>
      <div className="railboard" role="list" aria-label="Stage pipeline">
        {STAGES.map((stage) => {
          const isCurrent = stage.key === ticket.status;
          const canSet = destinations.includes(stage.key);
          const cls = [
            'railseg',
            isCurrent ? 'now' : '',
            stage.index < currentIndex ? 'done' : '',
            canSet ? 'open' : '',
            !canSet && !isCurrent ? 'locked' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={stage.key}
              type="button"
              role="listitem"
              className={cls}
              disabled={!canSet}
              title={stage.label}
              aria-label={isCurrent ? 'Current stage' : stage.label}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => choose(stage.key)}
            >
              <span className="bar" />
              <span className="nm">{stage.label}</span>
            </button>
          );
        })}
      </div>

      <div className="railkey">
        <span><i style={{ background: 'var(--sig-line)' }} />Passed</span>
        <span><i style={{ background: 'var(--sig)' }} />Now</span>
        <span style={{ marginLeft: 'auto' }}>
          You are {actor?.role}
          {' · '}
          <button type="button" className="btn btn-sm" onClick={() => setMenuOpen((v) => !v)} disabled={destinations.length === 0}>
            Move to…
          </button>
        </span>
      </div>

      {menuOpen && (
        <div className="menu" role="menu" style={{ position: 'relative', display: 'block' }}>
          {destinations.map((key) => (
            <button key={key} type="button" className="menuitem" role="menuitem" onClick={() => choose(key)}>
              {stageLabel(key)}
            </button>
          ))}
        </div>
      )}

      {pending && (
        <div className="dlg" style={{ position: 'relative', display: 'block', marginTop: 8 }}>
          <div className="dlg-head">
            <h3>{pending.kind === 'note' ? 'Reopen' : 'Close'} {ticket.ticketId}</h3>
          </div>
          <div className="dlg-body">
            <label className="lbl" htmlFor="transition-text">
              {pending.kind === 'note' ? 'Note (required to reopen)' : 'Reason (required to close)'}
            </label>
            <textarea
              id="transition-text" rows={3}
              value={text} onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="dlg-foot">
            <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={!text.trim()}>
              Confirm
            </button>
          </div>
        </div>
      )}
    </>
  );
}
