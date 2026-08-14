import { apiFetch } from './client.js';

export const listTeams = (project) => apiFetch(`/teams${project ? `?project=${project}` : ''}`);
export const getTeam = (id) => apiFetch(`/teams/${id}`);
export const createTeam = (body) => apiFetch('/teams', { method: 'POST', body });
export const patchTeam = (id, body) => apiFetch(`/teams/${id}`, { method: 'PATCH', body });
export const updateMembers = (id, body) =>
  apiFetch(`/teams/${id}/members`, { method: 'PATCH', body });
