'use client';

import { useEffect, useId, useRef } from 'react';

export default function RemarkDialog({
  open,
  title,
  label,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  value = '',
  onChange,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  const fieldId = useId();
  const titleId = useId();
  const trimmed = value.trim();

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, busy]);

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open, busy]);

  if (!open) return null;

  return (
    <div
      className="dscrim on"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={fieldId}
        aria-busy={busy || undefined}
        className="dlg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3 id={titleId}>{title}</h3>
        </div>
        <div className="dlg-body">
          <div className="form-row">
            <label htmlFor={fieldId}>{label}</label>
            <textarea
              id={fieldId}
              className="input"
              rows={4}
              value={value}
              onChange={onChange}
              disabled={busy}
            />
          </div>
        </div>
        <div className="dlg-foot">
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy || !trimmed}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <span className="btn-spin" aria-hidden="true" />
                Working…
              </>
            ) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
