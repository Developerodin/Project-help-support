import { apiFetch } from './client.js';

export const listUsers = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  ).toString();
  return apiFetch(`/users${search ? `?${search}` : ''}`);
};

export const inviteUser = (body) => apiFetch('/users', { method: 'POST', body });
export const patchUser = (id, body) => apiFetch(`/users/${id}`, { method: 'PATCH', body });
export const deleteUser = (id) => apiFetch(`/users/${id}`, { method: 'DELETE' });
export const resendInvite = (id) => apiFetch(`/users/${id}/resend-invite`, { method: 'POST' });
export const updateMe = (body) => apiFetch('/users/me', { method: 'PATCH', body });
export const updateNotificationPrefs = (body) =>
  apiFetch('/users/me/notification-prefs', { method: 'PATCH', body });

export const getTicketPreferences = () => apiFetch('/users/me/ticket-preferences');

export const updateTicketPreferences = (body) =>
  apiFetch('/users/me/ticket-preferences', { method: 'PATCH', body });

export const resetTicketPreferences = () =>
  apiFetch('/users/me/ticket-preferences/reset', { method: 'POST' });
