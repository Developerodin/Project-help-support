'use client';

import { useRef } from 'react';

export const NOTIFICATION_TAB_FOR_YOU = 'for-you';
export const NOTIFICATION_TAB_ALL = 'all';

const TABS = [
  { id: NOTIFICATION_TAB_FOR_YOU, label: 'For you' },
  { id: NOTIFICATION_TAB_ALL, label: 'All' },
];

export function notificationTabId(idPrefix, tab) {
  return `${idPrefix}-tab-${tab}`;
}

/**
 * "For you" / "All" tabs for the bell and the inbox. The caller renders the
 * tabpanel with `id={panelId}` and `aria-labelledby={notificationTabId(idPrefix, value)}`.
 */
export default function NotificationTabs({ value, onChange, idPrefix, panelId, className = '' }) {
  const refs = useRef({});

  function onKeyDown(event) {
    const index = TABS.findIndex((tab) => tab.id === value);
    let next = null;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
    if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
    if (event.key === 'Home') next = TABS[0];
    if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div
      className={['tabs', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label="Notifications"
      onKeyDown={onKeyDown}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => { refs.current[tab.id] = el; }}
          type="button"
          className="tab"
          role="tab"
          id={notificationTabId(idPrefix, tab.id)}
          aria-selected={value === tab.id}
          aria-controls={panelId}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
