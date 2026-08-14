/** Keep in sync with backend `platform/upload.js`. */
export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/avif,image/x-icon,' +
  'application/pdf,application/msword,application/vnd.ms-excel,application/vnd.ms-powerpoint,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,' +
  'application/vnd.oasis.opendocument.presentation,application/rtf,' +
  'video/mp4,video/webm,application/zip,application/gzip,application/x-7z-compressed,' +
  '.txt,.log,.csv,.json,.md,.xml,.yaml,.yml,' +
  '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.7z,.bmp,.tiff,.tif,.avif,.ico';

export const ATTACHMENT_HINT =
  'Images (PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF, ICO), documents (PDF, Office, OpenDocument, RTF, MD, XML, YAML, TXT, CSV, JSON), ' +
  'video (MP4, WebM), archives (ZIP, GZ, 7Z) · up to 10 files · 25 MB each';

const ALLOWED_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif', 'ico',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  'txt', 'log', 'csv', 'json', 'md', 'xml', 'yaml', 'yml',
  'mp4', 'webm', 'zip', 'gz', '7z',
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

/** @param {File[]} files @param {{ commentContent?: string, commentClientRef?: string }} [opts] */
export function buildAttachmentFormData(files, opts = {}) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  form.append('clientRef', crypto.randomUUID());
  if (opts.commentContent) form.append('commentContent', opts.commentContent);
  form.append('commentClientRef', opts.commentClientRef || crypto.randomUUID());
  return form;
}
