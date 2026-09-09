import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_BRAND } from '@pms/shared/email';
import logger from '../logger.js';
import * as storage from '../s3.js';

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

export class BrandLogoRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrandLogoRequiredError';
  }
}

function configuredMarkPath(config) {
  const raw = config?.branding?.emailLogoPath;
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_MARK_PATH;
  const trimmed = raw.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function loadDefaultMark(config) {
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

async function loadCompanyMark(config, logoKey, { requireCompanyMark = false } = {}) {
  const key = optionalString(logoKey);
  if (!key || !config?.features?.attachments) {
    if (requireCompanyMark) {
      throw new BrandLogoRequiredError('Brand logo is required for external branded ticket emails');
    }
    return null;
  }
  try {
    const url = await storage.presignGet(config, key);
    return {
      path: url,
      filename: basename(key) || 'brand-mark.png',
    };
  } catch (err) {
    if (requireCompanyMark) {
      throw new BrandLogoRequiredError('Brand logo could not be resolved for external branded ticket emails');
    }
    logger.warn('Company brand mark unavailable; using default mark', {
      logoKey: key,
      error: err.message,
    });
    return null;
  }
}

/** Nodemailer attachments for a message, or undefined when the mark is absent. */
export async function brandAttachments(config, options = {}) {
  const companyMark = await loadCompanyMark(
    config,
    options.logoKey,
    { requireCompanyMark: options.requireCompanyMark === true },
  );
  if (companyMark) {
    return [{
      filename: companyMark.filename,
      path: companyMark.path,
      cid: EMAIL_BRAND.logoCid,
      contentDisposition: 'inline',
    }];
  }

  const mark = loadDefaultMark(config);
  if (!mark) return undefined;
  return [{
    filename: mark.filename,
    content: mark.content,
    cid: EMAIL_BRAND.logoCid,
    contentDisposition: 'inline',
  }];
}
