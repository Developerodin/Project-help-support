'use client';

import { useEffect, useId, useRef } from 'react';
import { initials } from '@/shared/components/icons.jsx';

export default function CommentMentionPicker({
  open,
  candidates,
  activeIndex,
  onPick,
  onHover,
  loading = false,
  error = null,
  onRetry,
  label = 'Mention someone',
  listboxId = 'comment-mention-listbox',
}) {
  const generatedId = useId();
  const resolvedListboxId = listboxId || generatedId;
  const optionRefs = useRef([]);

  useEffect(() => {
    if (!open) return;
    const node = optionRefs.current[activeIndex];
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  if (!open) return null;

  return (
    <div
      className="mention-picker"
      role="listbox"
      id={resolvedListboxId}
      aria-label={label}
    >
      {loading ? (
        <p className="mention-picker__empty">Searching people…</p>
      ) : error ? (
        <div className="mention-picker__empty">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : candidates.length === 0 ? (
        <p className="mention-picker__empty">No matches. Keep typing a name.</p>
      ) : (
        <ul className="mention-picker__list">
          {candidates.map((person, index) => {
            const active = index === activeIndex;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  ref={(el) => { optionRefs.current[index] = el; }}
                  role="option"
                  aria-selected={active}
                  className={`mention-picker__option${active ? ' is-active' : ''}`}
                  onMouseEnter={() => onHover?.(index)}
                  onClick={() => onPick(person)}
                >
                  <span className="avatar sm" aria-hidden="true">{initials(person.name)}</span>
                  <span className="mention-picker__who">
                    <b>{person.name}</b>
                    {person.email ? <span>{person.email}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
