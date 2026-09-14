/** Keep in sync with backend `platform/upload.js`. */
export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/avif,image/x-icon,' +
  'application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,' +
  'application/vnd.oasis.opendocument.presentation,application/rtf,' +
  'video/mp4,video/webm,' +
  '.txt,.log,.csv,.json,.md,.xml,.yaml,.yml,' +
  '.docx,.xlsx,.pptx,.odt,.ods,.odp,.rtf,.bmp,.tiff,.tif,.avif,.ico';

export const ATTACHMENT_HINT =
  'Images (PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF, ICO), documents (PDF, modern Office, OpenDocument, RTF, MD, XML, YAML, TXT, CSV, JSON), ' +
  'video (MP4, WebM) · up to 10 files · 25 MB each';

const ALLOWED_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif', 'ico',
  'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  'txt', 'log', 'csv', 'json', 'md', 'xml', 'yaml', 'yml',
  'mp4', 'webm',
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

export function sameAttachmentFile(a, b) {
  const nameA = typeof a === 'string' ? a : a?.name || '';
  const sizeA = typeof a === 'string' ? 0 : a?.size ?? 0;
  const nameB = typeof b === 'string' ? b : b?.name || '';
  const sizeB = typeof b === 'string' ? 0 : b?.size ?? 0;
  return nameA === nameB && sizeA === sizeB;
}

/**
 * Per-file validation for incoming selections against pending + uploaded lists.
 * Invalid files are returned with `error` so the UI can show them inline.
 * @param {Array<File|{ file: File }>} pending
 * @param {Array<{ name: string, size?: number }>} uploaded
 * @param {File[]} incoming
 */
export function validateIncomingAttachments(pending, uploaded, incoming) {
  const pendingFiles = pending.map((item) => item.file || item);
  const known = [
    ...pendingFiles,
    ...uploaded.map((item) => ({ name: item.name, size: item.size })),
  ];
  const results = [];

  for (const file of incoming) {
    let error = null;

    if (!isAllowedAttachment(file)) {
      error = 'Type not allowed';
    } else if (file.size > MAX_ATTACHMENT_BYTES) {
      error = 'Exceeds 25 MB limit';
    } else if (
      known.some((item) => sameAttachmentFile(item, file))
      || results.some((item) => item.file && sameAttachmentFile(item.file, file))
    ) {
      error = 'Already added';
    } else if (known.length + results.filter((item) => !item.error).length >= MAX_ATTACHMENT_FILES) {
      error = 'Maximum 10 files allowed';
    }

    if (!error) known.push(file);
    results.push({ file, error });
  }

  return results;
}

/** @param {File[]} existing @param {File[]} incoming */
export function validateAttachmentBatch(existing, incoming) {
  const results = validateIncomingAttachments(existing, [], incoming);
  const errors = results.filter((item) => item.error).map((item) => `${item.file.name}: ${item.error}`);
  const valid = results.filter((item) => !item.error).map((item) => item.file);
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
