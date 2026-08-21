'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { capRole } from '@/shared/lib/profile-utils.js';
import RoleBadges from '@/shared/components/role-badges.jsx';

// ponytail: fixed-position portal instead of a popover/anchor-positioning lib —
// the panel has to escape .tablewrap's overflow clip. Swap for CSS anchor
// positioning once Safari/Firefox ship it.
const PANEL_MAX_H = 220;

export default function RoleMultiSelect({
  value = [],
  options,
  onChange,
  disabled = false,
  ariaLabel,
  busy = false,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const up = below < PANEL_MAX_H && above > below;
      setPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        top: up ? undefined : rect.bottom + 4,
        bottom: up ? window.innerHeight - rect.top + 4 : undefined,
        minWidth: rect.width,
        maxHeight: Math.max(120, (up ? above : below)),
      });
    };
    place();
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
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

  const panel = open && pos && (
    <div
      id={listId}
      ref={panelRef}
      className="role-multi-select__panel"
      role="group"
      aria-label={ariaLabel}
      style={pos}
    >
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
  );

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
      {panel && createPortal(panel, document.body)}
    </div>
  );
}
