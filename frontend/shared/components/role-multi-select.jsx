'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { capRole } from '@/shared/lib/profile-utils.js';
import RoleBadges from '@/shared/components/role-badges.jsx';

export default function RoleMultiSelect({
  value = [],
  options,
  onChange,
  disabled = false,
  ariaLabel,
  busy = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggleRole(role) {
    if (disabled || busy) return;
    const selected = new Set(value);
    if (selected.has(role)) {
      if (selected.size === 1) return;
      selected.delete(role);
    } else {
      selected.add(role);
    }
    onChange([...selected]);
  }

  return (
    <div className={`role-multi-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="role-multi-select__trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled || busy}
        onClick={() => setOpen((current) => !current)}
      >
        <RoleBadges roles={value} />
        <span className="role-multi-select__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={listId} className="role-multi-select__panel" role="group" aria-label={ariaLabel}>
          {options.map((role) => {
            const checked = value.includes(role);
            return (
              <label key={role} className="role-multi-select__option">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || busy || (checked && value.length === 1)}
                  onChange={() => toggleRole(role)}
                />
                <span>{capRole(role)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
