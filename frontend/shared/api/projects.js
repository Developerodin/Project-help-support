import { apiFetch } from './client.js';

export const listProjects = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  ).toString();
  return apiFetch(`/projects${search ? `?${search}` : ''}`);
};
export const getProject = (id) => apiFetch(`/projects/${id}`);
export const createProject = (body) => apiFetch('/projects', { method: 'POST', body });
export const patchProject = (id, body) => apiFetch(`/projects/${id}`, { method: 'PATCH', body });
export const replaceProjectTeamMembers = (id, members) =>
  apiFetch(`/projects/${id}/team-members`, { method: 'PUT', body: { members } });
export const replaceModules = (id, modules) =>
  apiFetch(`/projects/${id}/modules`, { method: 'PUT', body: { modules } });
export const getProjectClientTesters = (id) => apiFetch(`/projects/${id}/client-testers`);
export const replaceProjectClientTesters = (id, userIds) =>
  apiFetch(`/projects/${id}/client-testers`, { method: 'PUT', body: { userIds } });
