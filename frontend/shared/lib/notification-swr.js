import { useEffect, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { listNotifications, markAllRead, markRead } from '@/shared/api/notifications.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import { notificationTicketObjectId } from '@/shared/lib/notification-utils.js';

export const POLL_MS_HIDDEN = 30_000;
export const POLL_MS_VISIBLE = 15_000;
export const NOTIFICATION_DROPDOWN_LIMIT = 8;
export const NOTIFICATION_INBOX_LIMIT = 30;

// Notifications are the person's own, across every project they are in, so
// no key carries a project: the bell, inbox and sidebar badge all agree.
// "For you" and "All" lists get their own keys; every key keeps the
// `notifications` scope prefix so mutate and the optimistic patches reach both.
export const notificationSwrKeys = {
  unreadCount: () => 'notifications-unread-count',
  recent: (forYou = false) => `notifications-recent:${forYou ? 'for-you' : 'all'}`,
  inbox: (page, limit, unreadOnly = false, forYou = false) =>
    `notifications-inbox:${page}:${limit}:${unreadOnly ? 'unread' : 'all'}:${forYou ? 'for-you' : 'all'}`,
};

/** Pair scope key with params so SWR never runs a fetcher while params are null. */
export function notificationListSwrKey(scopeKey, params) {
  if (!scopeKey || !params) return null;
  return [scopeKey, params];
}

/** Unread total across everything: one row fetched, `totalResults` read. */
export function unreadCountSwrKey() {
  return notificationListSwrKey(notificationSwrKeys.unreadCount(), { unread: true, limit: 1 });
}

export function fetchNotificationList(key) {
  const params = Array.isArray(key) ? key[1] : null;
  if (!params) return null;
  return listNotifications(params);
}

/**
 * The scope string of a cache key. A mutate filter is handed the key as it was
 * passed to useSWR, so `[scopeKey, params]` arrives as the array, not a string.
 */
function scopeOf(key) {
  const scope = Array.isArray(key) ? key[0] : key;
  return typeof scope === 'string' ? scope : '';
}

export function isNotificationSwrKey(key) {
  return scopeOf(key).startsWith('notifications');
}

const isUnreadCountKey = (key) => scopeOf(key) === notificationSwrKeys.unreadCount();
const isListKey = (key) => {
  const scope = scopeOf(key);
  return scope.startsWith('notifications-recent:') || scope.startsWith('notifications-inbox:');
};

export function mutateNotifications() {
  return globalMutate(isNotificationSwrKey, undefined, { revalidate: true });
}

function patchListMarkRead(data, id) {
  if (!data?.results) return data;
  return {
    ...data,
    results: data.results.map((item) => (
      item.id === id && !item.readAt
        ? { ...item, readAt: new Date().toISOString() }
        : item
    )),
  };
}

function patchUnreadCountMarkRead(data, id) {
  if (!data) return data;
  const next = {
    ...data,
    totalResults: Math.max(0, (data.totalResults ?? 0) - 1),
  };
  if (Array.isArray(data.results)) {
    next.results = data.results.map((item) => (
      item.id === id && !item.readAt
        ? { ...item, readAt: new Date().toISOString() }
        : item
    ));
  }
  return next;
}

function patchListMarkAllRead(data) {
  if (!data?.results) return data;
  const now = new Date().toISOString();
  return {
    ...data,
    results: data.results.map((item) => (item.readAt ? item : { ...item, readAt: now })),
  };
}

export async function markNotificationRead(id) {
  await globalMutate(isUnreadCountKey, (data) => patchUnreadCountMarkRead(data, id), { revalidate: false });
  await globalMutate(isListKey, (data) => patchListMarkRead(data, id), { revalidate: false });
  try {
    await markRead(id);
    await mutateNotifications();
  } catch (err) {
    await mutateNotifications();
    showToast(normalizeApiError(err)?.message || 'Could not mark notification as read', { type: 'error' });
    throw err;
  }
}

/** Every project. */
export async function markAllNotificationsRead() {
  await globalMutate(
    isUnreadCountKey,
    (data) => (data ? { ...data, totalResults: 0, results: [] } : data),
    { revalidate: false },
  );
  await globalMutate(isListKey, (data) => patchListMarkAllRead(data), { revalidate: false });
  try {
    await markAllRead();
    await mutateNotifications();
  } catch (err) {
    await mutateNotifications();
    showToast(normalizeApiError(err)?.message || 'Could not mark all as read', { type: 'error' });
    throw err;
  }
}

/**
 * Opening a grouped row (several updates on one ticket) reads them all.
 * The badge drops by the unread rows for that ticket found in cached lists —
 * a lower bound when some sit on pages not loaded; the refetch settles it.
 */
export async function markTicketNotificationsRead(ticketObjectId) {
  const now = new Date().toISOString();
  const cleared = new Set();
  await globalMutate(isListKey, (data) => {
    if (!data?.results) return data;
    return {
      ...data,
      results: data.results.map((item) => {
        if (item.readAt || notificationTicketObjectId(item) !== ticketObjectId) return item;
        cleared.add(item.id);
        return { ...item, readAt: now };
      }),
    };
  }, { revalidate: false });
  await globalMutate(
    isUnreadCountKey,
    (data) => (data ? { ...data, totalResults: Math.max(0, (data.totalResults ?? 0) - cleared.size) } : data),
    { revalidate: false },
  );
  try {
    await markAllRead({ ticket: ticketObjectId });
    await mutateNotifications();
  } catch (err) {
    await mutateNotifications();
    showToast(normalizeApiError(err)?.message || 'Could not mark notifications as read', { type: 'error' });
    throw err;
  }
}

/** Shorter poll when the tab is visible; revalidate on focus / visibility. */
export function useNotificationPollInterval() {
  const [refreshInterval, setRefreshInterval] = useState(POLL_MS_HIDDEN);

  useEffect(() => {
    function syncInterval() {
      setRefreshInterval(
        document.visibilityState === 'visible' ? POLL_MS_VISIBLE : POLL_MS_HIDDEN,
      );
    }

    function onVisible() {
      syncInterval();
      if (document.visibilityState === 'visible') mutateNotifications();
    }

    function onFocus() {
      mutateNotifications();
    }

    syncInterval();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return refreshInterval;
}

export function unreadCountFrom(data) {
  return data?.totalResults ?? 0;
}
