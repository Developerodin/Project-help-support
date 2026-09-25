import { API_URL } from '../lib/env.js';
import { ApiClientError, apiFetch } from './client.js';

export const listNotifications = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.unread) qs.set('unread', 'true');
  if (params.forYou) qs.set('forYou', 'true');
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.project) qs.set('project', params.project);
  const q = qs.toString();
  return apiFetch(`/notifications${q ? `?${q}` : ''}`);
};

export const markRead = (id) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
export const markAllRead = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.project) qs.set('project', params.project);
  if (params.ticket) qs.set('ticket', params.ticket);
  const q = qs.toString();
  return apiFetch(`/notifications/read-all${q ? `?${q}` : ''}`, { method: 'POST' });
};

// Web push: whether it's configured (and the key to subscribe with), and this device's subscription.
export const getPushConfig = () => apiFetch('/notifications/push');
export const savePushSubscription = (subscription) =>
  apiFetch('/notifications/push/subscribe', { method: 'POST', body: subscription });
export const removePushSubscription = (endpoint) =>
  apiFetch('/notifications/push/unsubscribe', { method: 'POST', body: { endpoint } });

// Per-ticket mute/follow. `ticketId` is the ticket's Mongo id, not its key.
export const getTicketNotificationSettings = (ticketId) =>
  apiFetch(`/notifications/ticket-settings/${encodeURIComponent(ticketId)}`);
export const updateTicketNotificationSettings = (ticketId, body) =>
  apiFetch(`/notifications/ticket-settings/${encodeURIComponent(ticketId)}`, { method: 'PUT', body });

/*
 * The unsubscribe link in an email works signed out, so these skip apiFetch:
 * no bearer token, no cookie, and a 401 for a bad token must not start the
 * session refresh (or sign-out) flow meant for the signed-in app.
 */
async function publicFetch(path, method = 'GET') {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, credentials: 'omit' });
  } catch (error) {
    throw new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: error?.message || 'Network request failed' });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiClientError({
      status: response.status,
      code: payload.error?.code ?? 'UNKNOWN',
      message: payload.error?.message ?? `Request failed (${response.status})`,
    });
  }
  return response.status === 204 ? null : response.json();
}

const unsubscribePath = (action, token) =>
  `/notifications/email/${action}?token=${encodeURIComponent(token)}`;

export const getUnsubscribeStatus = (token) => publicFetch(unsubscribePath('unsubscribe', token));
export const unsubscribeEmail = (token) => publicFetch(unsubscribePath('unsubscribe', token), 'POST');
export const resubscribeEmail = (token) => publicFetch(unsubscribePath('resubscribe', token), 'POST');
