import { useEffect, useMemo, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { listNotifications, markAllRead, markRead } from '@/shared/api/notifications.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';
import { resolveViewProject } from '@/shared/lib/ticket-list-query.js';

export const POLL_MS_HIDDEN = 30_000;
export const POLL_MS_VISIBLE = 15_000;
export const NOTIFICATION_DROPDOWN_LIMIT = 8;
export const NOTIFICATION_INBOX_LIMIT = 30;

const projectKeySegment = (projectId) => (projectId ? String(projectId) : 'none');

export const notificationSwrKeys = {
  unreadCount: (projectId) => `notifications-unread-count:${projectKeySegment(projectId)}`,
  recent: (projectId) => `notifications-recent:${projectKeySegment(projectId)}`,
  inbox: (page, limit, unreadOnly = false, projectId) =>
    `notifications-inbox:${projectKeySegment(projectId)}:${page}:${limit}:${unreadOnly ? 'unread' : 'all'}`,
};

/** URL `project` wins; otherwise the active project from the switcher. */
export function useNotificationProjectScope() {
  const searchString = useHistorySearch();
  const { activeProjectId, loading: projectLoading } = useProject();
  const projectId = useMemo(
    () => resolveViewProject(searchString, activeProjectId),
    [searchString, activeProjectId],
  );
  return { projectId, projectLoading };
}

export function listNotificationsParams(base, projectId) {
  if (!projectId) return null;
  return { ...base, project: projectId };
}

/** Pair scope key with params so SWR never runs a fetcher while params are null. */
export function notificationListSwrKey(scopeKey, params) {
  if (!scopeKey || !params) return null;
  return [scopeKey, params];
}

export function fetchNotificationList(key) {
  const params = Array.isArray(key) ? key[1] : null;
  if (!params) return null;
  return listNotifications(params);
}

export function isNotificationSwrKey(key) {
  return typeof key === 'string' && key.startsWith('notifications');
}

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
  await globalMutate(
    (key) => typeof key === 'string' && key.startsWith('notifications-unread-count:'),
    (data) => patchUnreadCountMarkRead(data, id),
    { revalidate: false },
  );
  await globalMutate(
    (key) => typeof key === 'string' && (
      key.startsWith('notifications-recent:') || key.startsWith('notifications-inbox:')
    ),
    (data) => patchListMarkRead(data, id),
    { revalidate: false },
  );
  try {
    await markRead(id);
    await mutateNotifications();
  } catch (err) {
    await mutateNotifications();
    showToast(normalizeApiError(err)?.message || 'Could not mark notification as read', { type: 'error' });
    throw err;
  }
}

export async function markAllNotificationsRead(projectId) {
  const unreadKey = notificationSwrKeys.unreadCount(projectId);
  const listKeyMatcher = (key) => typeof key === 'string' && (
    key === notificationSwrKeys.recent(projectId)
    || (key.startsWith(`notifications-inbox:${projectKeySegment(projectId)}:`))
  );

  await globalMutate(
    unreadKey,
    (data) => (data ? { ...data, totalResults: 0, results: [] } : data),
    { revalidate: false },
  );
  await globalMutate(
    listKeyMatcher,
    (data) => patchListMarkAllRead(data),
    { revalidate: false },
  );
  try {
    const params = projectId ? { project: projectId } : {};
    await markAllRead(params);
    await mutateNotifications();
  } catch (err) {
    await mutateNotifications();
    showToast(normalizeApiError(err)?.message || 'Could not mark all as read', { type: 'error' });
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
