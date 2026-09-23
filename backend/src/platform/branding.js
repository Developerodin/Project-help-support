import { EXTERNAL_ROLES, isExternalUser } from '@pms/shared';
import Client from '../modules/clients/client.model.js';
import { loadScopedAssignmentsForUser } from '../modules/access/scoped-access.service.js';
import * as storage from './s3.js';

export const NEUTRAL_BRAND_NAME = 'ProwPlus';
/** Matches frontend DEFAULT_NEUTRAL_ICON_URL. */
export const DEFAULT_NEUTRAL_ICON_URL = '/branding/pp_icons.png';

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function userIdOf(user) {
  return user?.id ?? user?._id ?? null;
}

export function neutralBranding(config) {
  return {
    type: 'neutral',
    name: NEUTRAL_BRAND_NAME,
    logoUrl: optionalString(config?.branding?.neutralLogoUrl) ?? DEFAULT_NEUTRAL_ICON_URL,
    faviconUrl: optionalString(config?.branding?.neutralFaviconUrl) ?? DEFAULT_NEUTRAL_ICON_URL,
  };
}

async function companyLogoUrl(config, logoKey) {
  if (!logoKey || !config?.features?.attachments) return null;
  try {
    return await storage.presignGet(config, logoKey);
  } catch {
    return null;
  }
}

async function loadCompanyBranding(clientId, config) {
  const client = await Client.findById(clientId).select('name status logoKey').lean();
  if (!client || client.status !== 'active') return null;

  const name = optionalString(client.name);
  if (!name) return null;
  const logoUrl = await companyLogoUrl(config, client.logoKey);

  return {
    type: 'company',
    id: String(client._id),
    name,
    logoUrl,
    faviconUrl: logoUrl ?? neutralBranding(config).faviconUrl,
  };
}

/**
 * Client / client_tester see their company name + logo. Internal users always
 * get the neutral ProwPlus brand — even when they hold client-scoped assignments.
 */
export async function resolveEffectiveBrandingForUser(user, config) {
  if (!user || !isExternalUser(user)) return neutralBranding(config);

  const userId = userIdOf(user);
  if (!userId) return neutralBranding(config);

  const assignments = await loadScopedAssignmentsForUser(userId);
  const seen = new Set();
  for (const row of assignments) {
    if (!EXTERNAL_ROLES.includes(row?.role)) continue;
    const clientId = row?.clientId ? String(row.clientId) : null;
    if (!clientId || seen.has(clientId)) continue;
    seen.add(clientId);
    const branding = await loadCompanyBranding(clientId, config);
    if (branding) return branding;
  }

  return neutralBranding(config);
}
