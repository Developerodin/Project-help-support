import { apiFetch } from './client.js';

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const listTickets = (params) => apiFetch(`/tickets${query(params)}`);
export const getTicket = (id) => apiFetch(`/tickets/${encodeURIComponent(id)}`);
export const createTicket = (body) => apiFetch('/tickets', { method: 'POST', body });

export const patchTicket = (id, body) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body });

export const transitionTicket = (id, body) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}/transition`, { method: 'POST', body });

export const assignTicket = (id, body) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}/assign`, { method: 'POST', body });

export const watchTicket = (id) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}/watch`, { method: 'POST' });

export const unwatchTicket = (id) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}/watch`, { method: 'DELETE' });

export const addComment = (id, body) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}/comments`, { method: 'POST', body });

export const uploadAttachments = (id, formData) =>
  apiFetch(`/tickets/${encodeURIComponent(id)}/attachments`, { method: 'POST', formData });

export const attachmentDownloadUrl = (id, attachmentId) =>
  `/tickets/${encodeURIComponent(id)}/attachments/${attachmentId}/download`;
