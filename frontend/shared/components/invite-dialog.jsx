'use client';

import { useEffect, useId, useRef } from 'react';
import { EXTERNAL_ROLES, ROLE_IDS } from '@pms/shared';
import { capRole } from '@/shared/lib/profile-utils.js';
import FormError from '@/shared/components/form-error.jsx';

export default function InviteDialog({
  open,
  email = '',
  role = [ROLE_IDS.UNASSIGNED],
  roles,
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
  const roleGroupId = useId();
  const roleHintId = useId();
  const formId = useId();
  const titleId = useId();
  const descId = useId();
  const trimmed = email.trim();
  const selectedRoles = Array.isArray(role) ? role : [role];
  // ponytail: "unassigned" is the empty selection, not a checkbox. One state to
  // reason about, and no checkbox that refuses to uncheck itself.
  const options = roles.filter((item) => item !== ROLE_IDS.UNASSIGNED);
  const picked = selectedRoles.filter((item) => item !== ROLE_IDS.UNASSIGNED);
  // Staff and client roles are split because the difference is who the person
  // is, not what they do: one gets the workspace, the other gets their own
  // projects. A misclick across that line is the expensive one.
  const groups = [
    { key: 'team', caption: 'Team', items: options.filter((item) => !EXTERNAL_ROLES.includes(item)) },
    { key: 'client', caption: 'Client side', items: options.filter((item) => EXTERNAL_ROLES.includes(item)) },
  ].filter((group) => group.items.length);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
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

  function toggleRole(nextRole) {
    const selected = new Set(picked);
    if (selected.has(nextRole)) selected.delete(nextRole);
    else selected.add(nextRole);
    onRoleChange(selected.size ? [...selected] : [ROLE_IDS.UNASSIGNED]);
  }

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
          <p id={descId}>They set their name and password when they accept.</p>
        </div>
        <form
          id={formId}
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
          <div className="form-row invite-roles">
            <div className="invite-roles__head">
              <span id={roleGroupId} className="invite-roles__label">Roles</span>
              <span className="invite-roles__count">
                {picked.length ? `${picked.length} selected` : 'No access yet'}
              </span>
            </div>
            <div
              className="invite-roles__box"
              role="group"
              aria-labelledby={roleGroupId}
              aria-describedby={roleHintId}
            >
              {groups.map((group) => (
                <div key={group.key} className="invite-roles__group">
                  <p className="invite-roles__caption">{group.caption}</p>
                  <div className="invite-roles__grid">
                    {group.items.map((item) => {
                      const checked = picked.includes(item);
                      return (
                        <label key={item} className={`invite-role${checked ? ' is-on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() => toggleRole(item)}
                          />
                          <span>{capRole(item)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p id={roleHintId} className="invite-roles__hint">
              Roles set what they can open. You can change them any time.
            </p>
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
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={busy}
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
