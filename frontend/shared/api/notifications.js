import { apiFetch } from './client.js';

export const listNotifications = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.unread) qs.set('unread', 'true');
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
  const q = qs.toString();
  return apiFetch(`/notifications/read-all${q ? `?${q}` : ''}`, { method: 'POST' });
};

// Web push: whether it's configured (and the key to subscribe with), and this device's subscription.
export const getPushConfig = () => apiFetch('/notifications/push');
export const savePushSubscription = (subscription) =>
  apiFetch('/notifications/push/subscribe', { method: 'POST', body: subscription });
export const removePushSubscription = (endpoint) =>
  apiFetch('/notifications/push/unsubscribe', { method: 'POST', body: { endpoint } });
