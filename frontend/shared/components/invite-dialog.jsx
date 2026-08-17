'use client';

import { useEffect, useId, useRef } from 'react';
import { ROLES } from '@pms/shared';
import FormError from '@/shared/components/form-error.jsx';

export default function InviteDialog({
  open,
  email = '',
  role = 'member',
  error = null,
  busy = false,
  onEmailChange,
  onRoleChange,
  onConfirm,
  onCancel,
}) {
  const emailRef = useRef(null);
  const dialogRef = useRef(null);
  const emailId = useId();
  const roleId = useId();
  const titleId = useId();
  const descId = useId();
  const trimmed = email.trim();

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    // Focus the first FIELD, and do it in the same commit as the mount. A
    // deferred focus() yanks the caret away from anyone who started typing
    // inside the delay, and their keystrokes land on a button instead.
    emailRef.current?.focus();
    return () => { document.body.style.overflow = ''; };
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
        'button:not([disabled]), input:not([disabled]), select:not([disabled])',
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={busy || undefined}
        className="dlg invite-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3 id={titleId}>Invite someone</h3>
          <p id={descId}>They will set their name and password when accepting the invite.</p>
        </div>
        <form
          className="dlg-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && trimmed) onConfirm();
          }}
        >
          <FormError error={error} />
          <div className="form-row">
            <label htmlFor={emailId}>Email</label>
            <input
              ref={emailRef}
              id={emailId}
              type="email"
              required
              autoComplete="off"
              placeholder="name@company.com"
              value={email}
              onChange={onEmailChange}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label htmlFor={roleId}>Role</label>
            <select
              id={roleId}
              value={role}
              onChange={onRoleChange}
              disabled={busy}
            >
              {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </form>
        <div className="dlg-foot">
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
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
                Sending…
              </>
            ) : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
