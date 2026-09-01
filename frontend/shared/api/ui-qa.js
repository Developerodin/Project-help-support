import { apiFetch } from './client.js';

export const getUiQaProject = (projectId) => apiFetch(`/projects/${projectId}/ui-qa`);

export const getUiQaEntity = (projectId, entity) => {
  const search = new URLSearchParams({ entity: JSON.stringify(entity) }).toString();
  return apiFetch(`/projects/${projectId}/ui-qa/entity?${search}`);
};

export const updateUiQaStatus = (projectId, body) =>
  apiFetch(`/projects/${projectId}/ui-qa/status`, { method: 'PATCH', body });

export const addUiQaComment = (projectId, body) =>
  apiFetch(`/projects/${projectId}/ui-qa/comments`, { method: 'POST', body });

export const editUiQaComment = (projectId, commentId, body) =>
  apiFetch(`/projects/${projectId}/ui-qa/comments/${commentId}`, { method: 'PATCH', body });

export const deleteUiQaComment = (projectId, commentId, body) =>
  apiFetch(`/projects/${projectId}/ui-qa/comments/${commentId}`, { method: 'DELETE', body });

export const uploadUiQaAttachments = (projectId, formData) =>
  apiFetch(`/projects/${projectId}/ui-qa/attachments`, { method: 'POST', formData });

export const removeUiQaAttachment = (projectId, attachmentId, body) =>
  apiFetch(`/projects/${projectId}/ui-qa/attachments/${attachmentId}`, { method: 'DELETE', body });

export const uiQaAttachmentDownloadPath = (projectId, attachmentId, entity) => {
  const search = new URLSearchParams({ entity: JSON.stringify(entity) }).toString();
  return `/projects/${projectId}/ui-qa/attachments/${encodeURIComponent(attachmentId)}/download?${search}`;
};

/**
 * The download route requires Bearer auth, then returns a short-lived presigned URL.
 * Browser navigation cannot send that header, so resolve it here (same as tickets).
 */
export async function resolveUiQaAttachmentDownloadUrl(projectId, attachmentId, entity) {
  const { url } = await apiFetch(uiQaAttachmentDownloadPath(projectId, attachmentId, entity), {
    headers: { Accept: 'application/json' },
  });
  if (!url) throw new Error('Attachment download did not return a URL');
  return url;
}

export const getUiQaAttachmentDownloadUrl = (projectId, attachmentId, entity) =>
  resolveUiQaAttachmentDownloadUrl(projectId, attachmentId, entity).then((url) => ({ url }));
