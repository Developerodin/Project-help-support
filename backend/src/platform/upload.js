import { randomBytes } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { ApiError } from './errors.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

/**
 * ALLOWLIST, not a blocklist. A blocklist is a losing game against extensions
 * nobody thought of, and it only has to be wrong once.
 */
export const ALLOWED_TYPES = Object.freeze([
  { mime: 'image/png', exts: ['png'], magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }] },
  { mime: 'image/jpeg', exts: ['jpg', 'jpeg'], magic: [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }] },
  { mime: 'image/gif', exts: ['gif'], magic: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  { mime: 'image/webp', exts: ['webp'], magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }] },
  { mime: 'application/pdf', exts: ['pdf'], magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
  { mime: 'video/mp4', exts: ['mp4'], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },
  { mime: 'video/webm', exts: ['webm'], magic: [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }] },
  { mime: 'application/zip', exts: ['zip'], magic: [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }] },
  { mime: 'application/gzip', exts: ['gz'], magic: [{ offset: 0, bytes: [0x1F, 0x8B] }] },
]);

/** Text has no magic number, so it is validated by decoding instead. */
const TEXT_EXTS = Object.freeze(['txt', 'log', 'csv', 'json']);

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

  const sniffed = ALLOWED_TYPES.find((type) => type.magic.every((sig) => matches(buffer, sig)));

  if (sniffed) {
    if (!sniffed.exts.includes(ext)) {
      throw new ApiError(
        400, 'MIME_EXTENSION_MISMATCH',
        `The file content is ${sniffed.mime}, which does not match ".${ext}"`,
      );
    }
    return { mime: sniffed.mime, ext };
  }

  if (TEXT_EXTS.includes(ext) && looksLikeText(buffer)) return { mime: 'text/plain', ext };

  throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'That file type is not accepted');
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
