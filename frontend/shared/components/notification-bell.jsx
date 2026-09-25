'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Icon from '@/shared/components/icons.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import NotificationRow from '@/shared/components/notification-row.jsx';
import { getPushConfig } from '@/shared/api/notifications.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import {
  bellNotificationRows,
  notificationHref,
  notificationTicketObjectId,
} from '@/shared/lib/notification-utils.js';
import {
  NOTIFICATION_DROPDOWN_LIMIT,
  fetchNotificationList,
  markAllNotificationsRead,
  markNotificationRead,
  markTicketNotificationsRead,
  notificationListSwrKey,
  notificationSwrKeys,
  unreadCountFrom,
  unreadCountSwrKey,
  useNotificationPollInterval,
} from '@/shared/lib/notification-swr.js';
import { enablePush, pushStatus } from '@/shared/lib/push.js';
import { showToast } from '@/shared/lib/toast.js';

const PANEL_ID = 'notif-panel';
const HEADING_ID = 'notif-panel-title';
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PUSH_OFFER_DISMISSED_KEY = 'notif-push-offer-dismissed';

// Storage can be unavailable (private mode, blocked site data); the offer then
// simply comes back next time.
function pushOfferDismissed() {
  try {
    return window.localStorage.getItem(PUSH_OFFER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberPushOfferDismissed() {
  try {
    window.localStorage.setItem(PUSH_OFFER_DISMISSED_KEY, '1');
  } catch {
    /* see pushOfferDismissed */
  }
}

function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

function partitionBellItems(items) {
  const unread = [];
  const earlier = [];
  for (const item of items) {
    if (!item.readAt) unread.push(item);
    else earlier.push(item);
  }
  return { unread, earlier };
}

export default function NotificationBell() {
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const headingRef = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const liveId = useId();
  const [open, setOpen] = useState(false);
  const { impersonation } = useAuth();
  const [pushOffer, setPushOffer] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const refreshInterval = useNotificationPollInterval();

  const { data: unreadData, error: unreadError, mutate: mutateUnread } = useSWR(
    unreadCountSwrKey(),
    fetchNotificationList,
    { refreshInterval },
  );

  const {
    data: recentData,
    error: recentError,
    isLoading: recentLoading,
    mutate: mutateRecent,
  } = useSWR(
    open
      ? notificationListSwrKey(notificationSwrKeys.recent(), { limit: NOTIFICATION_DROPDOWN_LIMIT })
      : null,
    fetchNotificationList,
    { refreshInterval: open ? refreshInterval : 0 },
  );

  const unreadCount = unreadCountFrom(unreadData);
  const badge = unreadCount > 99 ? '99+' : String(unreadCount);
  const listError = recentError || unreadError;

  // Announce new arrivals only: not the first count on load, not every poll.
  const lastCountRef = useRef(null);
  useEffect(() => {
    if (!unreadData) return;
    const previous = lastCountRef.current;
    lastCountRef.current = unreadCount;
    if (previous !== null && unreadCount > previous) {
      setAnnouncement(`${unreadCount} unread notifications`);
    }
  }, [unreadData, unreadCount]);

  // Offer push where it would work and isn't on yet. Checked when the panel
  // opens rather than on every page, since it costs a request.
  useEffect(() => {
    if (!open || impersonation || pushOfferDismissed()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if ((await pushStatus()) !== 'off') return;
        const config = await getPushConfig();
        if (!cancelled) setPushOffer(Boolean(config?.enabled));
      } catch {
        /* no offer */
      }
    })();
    return () => { cancelled = true; };
  }, [open, impersonation]);

  const retry = useCallback(() => {
    mutateUnread();
    if (open) mutateRecent();
  }, [mutateUnread, mutateRecent, open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }

    const panel = panelRef.current;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (!panel?.contains(event.target)) return;

      const items = getFocusableElements(panel);
      if (items.length === 0) return;

      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[(index + 1 + items.length) % items.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (event.key === 'Tab') {
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Opening lands on the first notification (or the heading while there is
  // none yet), never on "Mark all read". Re-runs as rows load, but leaves
  // focus alone once it has moved elsewhere in the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    if (panel?.contains(active) && active !== headingRef.current) return;
    const firstRow = panel?.querySelector('.notif-row__title');
    (firstRow ?? headingRef.current)?.focus();
  }, [open, recentData]);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpenRef.current = open;
  }, [open]);

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
    } catch {
      /* toast shown in helper */
    }
  }

  async function turnOnPush() {
    setPushBusy(true);
    try {
      await enablePush();
      setPushOffer(false);
      showToast('Push turned on for this device');
    } catch (err) {
      showToast(normalizeApiError(err)?.message || err?.message || 'Could not turn on push', { type: 'error' });
      // Blocked just now, or otherwise no longer offerable: stop offering.
      if ((await pushStatus()) !== 'off') setPushOffer(false);
    } finally {
      setPushBusy(false);
    }
  }

  function dismissPushOffer() {
    rememberPushOfferDismissed();
    setPushOffer(false);
  }

  /** A grouped row ("+N more for WEB-1") reads all of that ticket's updates. */
  async function handleItemNavigate(event, item, grouped) {
    const href = notificationHref(item.link);
    const ticketObjectId = grouped ? notificationTicketObjectId(item) : null;
    if (!item.readAt) {
      event.preventDefault();
      setOpen(false);
      try {
        if (ticketObjectId) await markTicketNotificationsRead(ticketObjectId);
        else await markNotificationRead(item.id);
        router.push(href);
      } catch {
        /* toast shown in helper */
      }
      return;
    }
    setOpen(false);
  }

  const rawItems = recentData?.results ?? [];
  const { unread: unreadItems, earlier: earlierItems } = useMemo(
    () => partitionBellItems(rawItems),
    [rawItems],
  );

  const unreadRows = useMemo(() => bellNotificationRows(unreadItems), [unreadItems]);
  const earlierRows = useMemo(() => bellNotificationRows(earlierItems), [earlierItems]);
  const showEmpty = !recentLoading && !listError && rawItems.length === 0;
  const showRecentLoader = open && recentLoading && !listError;

  function renderBellRow(row) {
    const { latest, hidden, ticketKey } = row;
    return (
      <div key={latest.id} className="notif-bell__row-wrap">
        <NotificationRow
          item={latest}
          as="link"
          className="notif-bell__row"
          onNavigate={(event, item) => handleItemNavigate(event, item, hidden > 0)}
        />
        {hidden > 0 && ticketKey ? (
          <p className="notif-bell__more meta">
            +{hidden} more for {ticketKey}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="menuwrap notif-bell" ref={wrapRef}>
      <span id={liveId} className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ico notif-bell__trigger"
        aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={PANEL_ID}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="bell" size={14} />
        <span className="notif-bell__badge-slot" aria-hidden="true">
          {unreadCount > 0 ? (
            <span className="notif-bell__badge">{badge}</span>
          ) : null}
        </span>
      </button>

      <div
        ref={panelRef}
        id={PANEL_ID}
        className={`menu wide notif-bell__panel${open ? ' on' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby={HEADING_ID}
        hidden={!open}
      >
        <div className="menucap notif-bell__head">
          <strong id={HEADING_ID} ref={headingRef} tabIndex={-1}>Notifications</strong>
          {unreadCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleMarkAllRead}>
              Mark all read
            </button>
          )}
        </div>

        {pushOffer ? (
          <div className="notif-bell__push">
            <span className="meta">Get alerts on this device</span>
            <button type="button" className="btn btn-sm" onClick={turnOnPush} disabled={pushBusy}>
              Turn on
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-ico"
              aria-label="Don't suggest push again"
              onClick={dismissPushOffer}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ) : null}

        <div className="menuscroll notif-bell__scroll">
          {showRecentLoader && (
            <div className="notif-bell__loading">
              <AppLoader inline label="Loading…" ariaLabel="Loading notifications" />
            </div>
          )}

          {listError && !recentLoading && (
            <div className="notif-bell__error">
              <p className="meta">Could not load notifications.</p>
              <button type="button" className="btn btn-sm" onClick={retry}>
                Retry
              </button>
            </div>
          )}

          {showEmpty && (
            <p className="notif-bell__empty meta">No notifications yet.</p>
          )}

          {!recentLoading && !listError && unreadRows.length > 0 && (
            <section className="notif-bell__section" aria-label="Unread">
              <p className="notif-bell__section-label meta">Unread</p>
              <div className="notif-bell__list">
                {unreadRows.map(renderBellRow)}
              </div>
            </section>
          )}

          {!recentLoading && !listError && earlierRows.length > 0 && (
            <section className="notif-bell__section" aria-label="Earlier">
              {unreadRows.length > 0 ? (
                <p className="notif-bell__section-label meta">Earlier</p>
              ) : null}
              <div className="notif-bell__list">
                {earlierRows.map(renderBellRow)}
              </div>
            </section>
          )}

        </div>

        <div className="menusep" />
        <Link href="/notifications" className="menuitem" onClick={() => setOpen(false)}>
          View all notifications
        </Link>
      </div>
    </div>
  );
}
