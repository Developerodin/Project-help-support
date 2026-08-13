'use client';

import { useEffect, useRef } from 'react';

export default function ValidationDialog({
  open,
  title = 'Fill in required fields',
  message = 'Complete the highlighted fields before filing this ticket.',
  items = [],
  onClose,
}) {
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dscrim on" role="presentation" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="validation-dialog-title"
        aria-describedby="validation-dialog-desc"
        className="dlg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3 id="validation-dialog-title">{title}</h3>
          <p id="validation-dialog-desc">{message}</p>
        </div>
        {items.length > 0 ? (
          <div className="dlg-body">
            <ul className="reqs" role="list">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="dlg-foot">
          <span className="spacer" />
          <button
            ref={closeBtnRef}
            type="button"
            className="btn btn-primary"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
