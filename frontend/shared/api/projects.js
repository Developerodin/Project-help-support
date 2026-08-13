import { apiFetch } from './client.js';

export const listProjects = () => apiFetch('/projects');
export const getProject = (id) => apiFetch(`/projects/${id}`);
export const createProject = (body) => apiFetch('/projects', { method: 'POST', body });
export const patchProject = (id, body) => apiFetch(`/projects/${id}`, { method: 'PATCH', body });
export const replaceModules = (id, modules) =>
  apiFetch(`/projects/${id}/modules`, { method: 'PUT', body: { modules } });
