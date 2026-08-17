import { apiFetch } from './client.js';

export const listClients = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  ).toString();
  return apiFetch(`/clients${search ? `?${search}` : ''}`);
};

export const createClient = (body) => apiFetch('/clients', { method: 'POST', body });
export const getClient = (id) => apiFetch(`/clients/${id}`);
export const patchClient = (id, body) => apiFetch(`/clients/${id}`, { method: 'PATCH', body });

export const uploadClientLogo = (id, file) => {
  const formData = new FormData();
  formData.append('logo', file);
  return apiFetch(`/clients/${id}/logo`, { method: 'POST', formData });
};

export const removeClientLogo = (id) => apiFetch(`/clients/${id}/logo`, { method: 'DELETE' });
