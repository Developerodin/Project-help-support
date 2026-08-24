export const NEUTRAL_BRAND_NAME = 'ProwPlus';
export const DEFAULT_NEUTRAL_ICON_URL = '/branding/pp_icons.png';

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

export function applyDocumentBranding(raw) {
  if (typeof document === 'undefined') return;

  const branding = resolveEffectiveBranding(raw);
  const displayName = formatBrandDisplayName(branding.name);
  document.title = branding.type === 'company'
    ? `${displayName} · ${formatBrandDisplayName(NEUTRAL_BRAND_NAME)}`
    : displayName;

  const targetIcon = branding.faviconUrl ?? neutralFaviconUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL;
  brandIconLink().setAttribute('href', targetIcon);
}
