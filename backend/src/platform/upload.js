import { randomBytes } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { ApiError } from './errors.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

/**
 * ALLOWLIST, not a blocklist. A blocklist is a losing game against extensions
 * nobody thought of, and it only has to be wrong once.
 */
const OLE_MAGIC = [{ offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }];
const ZIP_MAGIC = [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }];

export const ALLOWED_TYPES = Object.freeze([
  { mime: 'image/png', exts: ['png'], magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }] },
  { mime: 'image/jpeg', exts: ['jpg', 'jpeg'], magic: [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }] },
  { mime: 'image/gif', exts: ['gif'], magic: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  { mime: 'image/webp', exts: ['webp'], magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }] },
  { mime: 'image/bmp', exts: ['bmp'], magic: [{ offset: 0, bytes: [0x42, 0x4D] }] },
  { mime: 'image/tiff', exts: ['tiff', 'tif'], magic: [{ offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00] }] },
  { mime: 'image/tiff', exts: ['tiff', 'tif'], magic: [{ offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A] }] },
  { mime: 'image/avif', exts: ['avif'], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, { offset: 8, bytes: [0x61, 0x76, 0x69, 0x66] }] },
  { mime: 'image/x-icon', exts: ['ico'], magic: [{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }] },
  { mime: 'application/pdf', exts: ['pdf'], magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
  { mime: 'application/msword', exts: ['doc'], magic: OLE_MAGIC },
  // Office formats may embed macros; magic-byte sniffing does not scan contents.
  // Treat uploads as untrusted documents until a dedicated AV pipeline exists.
  { mime: 'application/vnd.ms-excel', exts: ['xls'], magic: OLE_MAGIC },
  { mime: 'application/vnd.ms-powerpoint', exts: ['ppt'], magic: OLE_MAGIC },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', exts: ['docx'], magic: ZIP_MAGIC },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exts: ['xlsx'], magic: ZIP_MAGIC },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', exts: ['pptx'], magic: ZIP_MAGIC },
  { mime: 'application/vnd.oasis.opendocument.text', exts: ['odt'], magic: ZIP_MAGIC },
  { mime: 'application/vnd.oasis.opendocument.spreadsheet', exts: ['ods'], magic: ZIP_MAGIC },
  { mime: 'application/vnd.oasis.opendocument.presentation', exts: ['odp'], magic: ZIP_MAGIC },
  { mime: 'application/rtf', exts: ['rtf'], magic: [{ offset: 0, bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66] }] },
  { mime: 'video/mp4', exts: ['mp4'], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },
  { mime: 'video/webm', exts: ['webm'], magic: [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }] },
  { mime: 'application/zip', exts: ['zip'], magic: ZIP_MAGIC },
  { mime: 'application/gzip', exts: ['gz'], magic: [{ offset: 0, bytes: [0x1F, 0x8B] }] },
  { mime: 'application/x-7z-compressed', exts: ['7z'], magic: [{ offset: 0, bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] }] },
]);

/** Text has no magic number, so it is validated by decoding instead. */
const TEXT_EXTS = Object.freeze(['txt', 'log', 'csv', 'json', 'md', 'xml', 'yaml', 'yml']);

/** Rejected before anything is sniffed. `.svg` is here because it is scriptable. */
export const BLOCKED_EXTENSIONS = Object.freeze([
  'exe', 'dll', 'sh', 'bat', 'cmd', 'ps1', 'jar', 'msi', 'com', 'scr',
  'app', 'deb', 'rpm', 'svg', 'html', 'htm', 'js', 'mjs', 'php',
]);

const matches = (buffer, { offset, bytes }) => bytes.every((b, i) => buffer[offset + i] === b);

function looksLikeText(buffer) {
  // No NUL bytes, and valid UTF-8 that survives a round trip.
  if (buffer.includes(0x00)) return false;
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

/**
 * The declared Content-Type header is attacker-controlled and is never
 * consulted. Content decides the type; the extension must then agree with it.
 */
export function sniffType(buffer, filename) {
  const ext = path.extname(String(filename || '')).slice(1).toLowerCase();

  if (!ext) throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'A file extension is required');
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    throw new ApiError(400, 'BLOCKED_FILE_TYPE', `".${ext}" files are not accepted`);
  }

  const candidates = ALLOWED_TYPES.filter((type) => type.magic.every((sig) => matches(buffer, sig)));

  if (candidates.length) {
    const sniffed = candidates.find((type) => type.exts.includes(ext));
    if (!sniffed) {
      throw new ApiError(
        400, 'MIME_EXTENSION_MISMATCH',
        `The file content does not match ".${ext}"`,
      );
    }
    return { mime: sniffed.mime, ext };
  }

  if (TEXT_EXTS.includes(ext) && looksLikeText(buffer)) return { mime: 'text/plain', ext };

  throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'That file type is not accepted');
}

/** Company logos accept image types only, with a smaller size limit than ticket attachments. */
export function sniffImageType(buffer, filename) {
  const result = sniffType(buffer, filename);
  if (!result.mime.startsWith('image/')) {
    throw new ApiError(400, 'INVALID_LOGO_TYPE', 'Logo must be an image file (PNG, JPEG, GIF, or WebP)');
  }
  return result;
}

/**
 * The original filename is NEVER an input here. It is kept as display metadata
 * only, so a name containing `../` or control characters cannot influence where
 * an object is written.
 */
export function safeKey(userId, ext, { prefix = 'tickets' } = {}) {
  return `${prefix}/${userId}/${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
}

/**
 * Memory storage: files are sniffed before they go anywhere, and nothing
 * untrusted is written to the server's disk. Both limits are enforced here AND
 * mirrored in the S3 bucket policy — a limit that exists in one place is a
 * limit that gets bypassed.
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 10, fieldSize: 1024 * 1024 },
}).array('files', 10);

export const logoUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
}).single('logo');
