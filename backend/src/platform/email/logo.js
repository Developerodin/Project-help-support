import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_BRAND } from '@pms/shared/email';
import logger from '../logger.js';

// backend/src/platform/email -> repo root -> shared/email/assets
const MARK_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../shared/email/assets/prowplus-icon.png',
);

/**
 * Read once, reuse for the life of the process: 1.4KB held in memory beats a
 * disk hit per recipient on a fan-out.
 *
 * A missing file degrades to no attachment rather than a failed send. The
 * header still reads "PROWPLUS PMS" as live text, so a message without the mark
 * is plainer, not broken. Regenerate with: node scripts/build-brand-assets.mjs
 */
let cached;

function loadMark() {
  if (cached !== undefined) return cached;
  try {
    cached = readFileSync(MARK_PATH);
  } catch (err) {
    cached = null;
    logger.warn('Brand mark missing; email will send without the logo', {
      path: MARK_PATH,
      error: err.message,
    });
  }
  return cached;
}

/** Nodemailer attachments for a message, or undefined when the mark is absent. */
export function brandAttachments() {
  const content = loadMark();
  if (!content) return undefined;
  return [{
    filename: 'prowplus-icon.png',
    content,
    cid: EMAIL_BRAND.logoCid,
    contentDisposition: 'inline',
  }];
}
