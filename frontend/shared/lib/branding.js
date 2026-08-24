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

function removeAllBrandIcons() {
  document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
    .forEach((node) => node.remove());
}

export function applyDocumentBranding(raw) {
  if (typeof document === 'undefined') return;

  const branding = resolveEffectiveBranding(raw);
  const displayName = formatBrandDisplayName(branding.name);
  document.title = branding.type === 'company'
    ? `${displayName} · ${formatBrandDisplayName(NEUTRAL_BRAND_NAME)}`
    : displayName;

  const targetIcon = branding.faviconUrl ?? neutralFaviconUrlFromEnv() ?? DEFAULT_NEUTRAL_ICON_URL;
  removeAllBrandIcons();

  const node = document.createElement('link');
  node.setAttribute('rel', 'icon');
  node.setAttribute('href', targetIcon);
  document.head.appendChild(node);
}
