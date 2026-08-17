import { apiFetch } from './client.js';

export const listTeams = (params = {}) => {
  const normalized = typeof params === 'string' ? { project: params } : params;
  const search = new URLSearchParams(
    Object.entries(normalized).filter(([, v]) => v !== undefined && v !== ''),
  ).toString();
  return apiFetch(`/teams${search ? `?${search}` : ''}`);
};
export const getTeam = (id) => apiFetch(`/teams/${id}`);
export const createTeam = (body) => apiFetch('/teams', { method: 'POST', body });
export const patchTeam = (id, body) => apiFetch(`/teams/${id}`, { method: 'PATCH', body });
export const updateMembers = (id, body) =>
  apiFetch(`/teams/${id}/members`, { method: 'PATCH', body });
