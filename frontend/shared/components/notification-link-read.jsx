'use client';

import { useEffect, useRef } from 'react';
import { markNotificationRead } from '@/shared/lib/notification-swr.js';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';

export const NOTIF_PARAM = 'notif';
const OBJECT_ID = /^[a-f\d]{24}$/i;

/** The address without `notif`, keeping every other param and the hash. */
export function withoutNotifParam(pathname, search, hash = '') {
  const params = new URLSearchParams(search);
  params.delete(NOTIF_PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

/**
 * A push notification opens `...&notif=<id>`: reading it through the push is
 * reading the notification, so mark it read, then drop the param so a reload
 * or a shared link doesn't carry it.
 *
 * Uses history.replaceState rather than router.replace, the same as the
 * tickets page, so the address bar has one writer and the page's own
 * ticket/project/comment handling sees an unchanged view.
 */
export default function NotificationLinkRead() {
  const search = useHistorySearch();
  const handled = useRef(null);

  useEffect(() => {
    const id = new URLSearchParams(search).get(NOTIF_PARAM);
    if (!id) return;
    const { pathname, search: current, hash } = window.location;
    window.history.replaceState(null, '', withoutNotifParam(pathname, current, hash));
    if (!OBJECT_ID.test(id) || handled.current === id) return;
    handled.current = id;
    markNotificationRead(id).catch(() => { /* toast shown in helper */ });
  }, [search]);

  return null;
}
