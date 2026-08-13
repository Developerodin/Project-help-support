import { apiFetch } from './client.js';

export const listNotifications = (unread) =>
  apiFetch(`/notifications${unread ? '?unread=true' : ''}`);
export const markRead = (id) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
export const markAllRead = () => apiFetch('/notifications/read-all', { method: 'POST' });
