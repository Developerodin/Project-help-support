export const NEUTRAL_BRAND_NAME = 'ProwPlus';
/** Internal/neutral mark (blue line art). Not /prowplus-icon.png or /icons/* legacy rasters. */
export const DEFAULT_NEUTRAL_ICON_URL = '/branding/pp_icons.png';

/** Cookie read by `/manifest.webmanifest` so install name/icons can vary per user. */
export const PWA_BRAND_COOKIE = 'prowplus_pwa_brand';

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function neutralLogoUrlFromEnv() {
  return optionalString(process.env.NEXT_PUBLIC_NEUTRAL_BRAND_LOGO_URL);
}

function neutralFaviconUrlFromEnv() {
  return optionalString(process.env.NEXT_PUBLIC_NEUTRAL_BRAND_FAVICON_URL);
}

export function formatBrandDisplayName(name) {
  const base = optionalString(name) || NEUTRAL_BRAND_NAME;
  return `${base} PMS`;
}

export function neutralBranding() {
  return {
    type: 'neutral',
    name: NEUTRAL_BRAND_NAME,
    logoUrl: neutralLogoUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL,
    faviconUrl: neutralFaviconUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL,
  };
}

function normaliseCompanyBranding(raw) {
  const name = optionalString(raw?.name);
  if (!name) return null;
  const logoUrl = optionalString(raw?.logoUrl);
  const faviconUrl = optionalString(raw?.faviconUrl) ?? logoUrl;
  return {
    type: 'company',
    id: optionalString(raw?.id) ?? undefined,
    name,
    logoUrl,
    faviconUrl,
  };
}

function normaliseNeutralBranding(raw) {
  return {
    type: 'neutral',
    name: optionalString(raw?.name) || NEUTRAL_BRAND_NAME,
    logoUrl: optionalString(raw?.logoUrl) ?? neutralLogoUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL,
    faviconUrl: optionalString(raw?.faviconUrl) ?? neutralFaviconUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL,
  };
}

export function resolveEffectiveBranding(raw) {
  if (raw?.type === 'company') {
    const company = normaliseCompanyBranding(raw);
    if (company) return company;
  }
  if (raw?.type === 'neutral') {
    return normaliseNeutralBranding(raw);
  }
  return neutralBranding();
}

/** Window / install label: company name for external brand, else ProwPlus. */
export function resolvePwaDisplayName(branding) {
  const resolved = resolveEffectiveBranding(branding);
  if (resolved.type === 'company' && resolved.name) return resolved.name;
  return NEUTRAL_BRAND_NAME;
}

/** Manifest `short_name` — browsers expect a compact label (max 12). */
export function truncatePwaShortName(name, max = 12) {
  const base = optionalString(name) || NEUTRAL_BRAND_NAME;
  if (base.length <= max) return base;
  return base.slice(0, max);
}

export function brandDescription(branding) {
  const resolved = resolveEffectiveBranding(branding);
  if (resolved.type === 'company') {
    return `${formatBrandDisplayName(resolved.name)} workspace on ${formatBrandDisplayName(NEUTRAL_BRAND_NAME)}`;
  }
  return `Project and ticket management on ${formatBrandDisplayName(NEUTRAL_BRAND_NAME)}`;
}

const BRAND_ICON_ATTR = 'data-brand-icon';

/**
 * React owns every <link>, <title> and <meta> it renders into <head> — they are
 * hoistables with a fiber behind them. Detaching one leaves React holding a
 * fiber whose node has no parent, and its next unmount dies on
 * `parentNode.removeChild(...)` of null, taking the pending navigation with it.
 *
 * So branding creates exactly one icon link and only ever rewrites that one.
 * It never queries for, moves, or removes an icon it did not create — which is
 * also why the app ships no `app/icon.png`: a second, React-owned favicon would
 * be a second owner of the same slot.
 */
function brandIconLink() {
  const existing = document.head.querySelector(`link[${BRAND_ICON_ATTR}]`);
  if (existing) return existing;

  const node = document.createElement('link');
  node.setAttribute('rel', 'icon');
  node.setAttribute(BRAND_ICON_ATTR, '');
  document.head.appendChild(node);
  return node;
}

function setAppleWebAppTitle(title) {
  const node = document.head.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (node) node.setAttribute('content', title);
}

/**
 * Lightweight same-origin cookie so the dynamic manifest can vary by user
 * without access to the httpOnly refresh token (path-scoped to /v1/auth).
 * Stores only non-secret brand display fields.
 */
export function syncPwaBrandCookie(raw) {
  if (typeof document === 'undefined') return;

  const branding = resolveEffectiveBranding(raw);
  if (branding.type === 'company' && branding.name) {
    const payload = { name: branding.name };
    if (branding.logoUrl) payload.logoUrl = branding.logoUrl;
    const value = encodeURIComponent(JSON.stringify(payload));
    // Drop logo from cookie if the payload would blow typical ~4KB cookie limits.
    if (value.length > 3500) {
      document.cookie = `${PWA_BRAND_COOKIE}=${encodeURIComponent(JSON.stringify({ name: branding.name }))}; path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
      return;
    }
    document.cookie = `${PWA_BRAND_COOKIE}=${value}; path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
    return;
  }

  document.cookie = `${PWA_BRAND_COOKIE}=; path=/; SameSite=Lax; Max-Age=0`;
}

export function parsePwaBrandCookie(rawValue) {
  const encoded = optionalString(rawValue);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    const name = optionalString(parsed?.name);
    if (!name) return null;
    return {
      name,
      logoUrl: optionalString(parsed?.logoUrl),
    };
  } catch {
    return null;
  }
}

export function applyDocumentBranding(raw) {
  if (typeof document === 'undefined') return;

  const branding = resolveEffectiveBranding(raw);
  const title = resolvePwaDisplayName(branding);
  document.title = title;
  setAppleWebAppTitle(title);
  syncPwaBrandCookie(branding);

  const targetIcon = branding.faviconUrl ?? neutralFaviconUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL;
  brandIconLink().setAttribute('href', targetIcon);
}
