/** Keep in sync with backend `platform/upload.js`. */
export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,video/mp4,video/webm,application/zip,application/gzip,.txt,.log,.csv,.json';

export const ATTACHMENT_HINT =
  'PNG, JPEG, GIF, WebP, PDF, MP4, WebM, ZIP, GZ, TXT, LOG, CSV, JSON · up to 10 files · 25 MB each';

const ALLOWED_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'mp4', 'webm', 'zip', 'gz', 'txt', 'log', 'csv', 'json',
]);

const BLOCKED_EXT = new Set([
  'exe', 'dll', 'sh', 'bat', 'cmd', 'ps1', 'jar', 'msi', 'com', 'scr',
  'app', 'deb', 'rpm', 'svg', 'html', 'htm', 'js', 'mjs', 'php',
]);

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / k ** i).toFixed(i === 0 ? 0 : 2)} ${sizes[i]}`;
}

export function fileExtension(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isAllowedAttachment(file) {
  const ext = fileExtension(file.name);
  if (!ext) return false;
  if (BLOCKED_EXT.has(ext)) return false;
  if (ALLOWED_EXT.has(ext)) return true;
  const type = file.type || '';
  return type.startsWith('image/') || type.startsWith('video/');
}

/** @param {File[]} existing @param {File[]} incoming */
export function validateAttachmentBatch(existing, incoming) {
  const errors = [];
  const valid = [];

  if (existing.length + incoming.length > MAX_ATTACHMENT_FILES) {
    errors.push('Maximum 10 files allowed.');
    return { errors, valid: [] };
  }

  for (const file of incoming) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${file.name}: exceeds 25 MB limit`);
    } else if (!isAllowedAttachment(file)) {
      errors.push(`${file.name}: type not allowed`);
    } else {
      valid.push(file);
    }
  }

  return { errors, valid };
}

/** @param {File[]} files */
export function buildAttachmentFormData(files) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  form.append('clientRef', crypto.randomUUID());
  return form;
}
