import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_BRAND } from '@pms/shared/email';
import logger from '../logger.js';

// backend/src/platform/email -> repo root -> shared/email/assets
const DEFAULT_MARK_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../shared/email/assets/prowplus-icon.png',
);

/**
 * Read once, reuse for the life of the process: 1.4KB held in memory beats a
 * disk hit per recipient on a fan-out.
 *
 * A missing file degrades to no attachment rather than a failed send. The
 * header still reads "ProwPlus" as live text, so a message without the mark
 * is plainer, not broken. Regenerate with: node scripts/build-brand-assets.mjs
 */
const cache = new Map();

function configuredMarkPath(config) {
  const raw = config?.branding?.emailLogoPath;
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_MARK_PATH;
  const trimmed = raw.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
}

function loadMark(config) {
  const path = configuredMarkPath(config);
  if (cache.has(path)) return cache.get(path);

  let content = null;
  try {
    content = readFileSync(path);
  } catch (err) {
    logger.warn('Brand mark missing; email will send without the logo', {
      path,
      error: err.message,
    });
  }
  const loaded = content
    ? { content, filename: basename(path) || 'brand-mark.png' }
    : null;
  cache.set(path, loaded);
  return loaded;
}

/** Nodemailer attachments for a message, or undefined when the mark is absent. */
export function brandAttachments(config) {
  const mark = loadMark(config);
  if (!mark) return undefined;
  return [{
    filename: mark.filename,
    content: mark.content,
    cid: EMAIL_BRAND.logoCid,
    contentDisposition: 'inline',
  }];
}
