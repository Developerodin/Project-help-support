import { apiFetch } from './client.js';

export const listUsers = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  ).toString();
  return apiFetch(`/users${search ? `?${search}` : ''}`);
};

export const inviteUser = (body) => apiFetch('/users', { method: 'POST', body });
export const patchUser = (id, body) => apiFetch(`/users/${id}`, { method: 'PATCH', body });
export const resendInvite = (id) => apiFetch(`/users/${id}/resend-invite`, { method: 'POST' });
export const updateNotificationPrefs = (body) =>
  apiFetch('/users/me/notification-prefs', { method: 'PATCH', body });
