import { cookies } from 'next/headers';
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRAND_SHORT,
} from '@/shared/lib/brand.js';
import {
  NEUTRAL_BRAND_NAME,
  parsePwaBrandCookie,
  PWA_BRAND_COOKIE,
  truncatePwaShortName,
} from '@/shared/lib/branding.js';

export const dynamic = 'force-dynamic';

// Cache-busted filenames so Windows/Chrome pick up ProwPlus art on reinstall
// (same URL with replaced pixels often stays cached from the prior install).
const PROWPLUS_ICONS = [
  {
    src: '/icons/icon-192-prowplus.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: '/icons/icon-512-prowplus.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: '/icons/icon-192-maskable-prowplus.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'maskable',
  },
  {
    src: '/icons/icon-512-maskable-prowplus.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
];

function isUsableLogoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const src = value.trim();
  if (src.startsWith('/')) return true;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function guessImageType(src) {
  const path = src.split('?')[0].toLowerCase();
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.png')) return 'image/png';
  return undefined;
}

function buildManifest({ name, shortName, description, icons }) {
  return {
    id: '/',
    name,
    short_name: shortName,
    description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#fcfbf9',
    background_color: '#fcfbf9',
    icons,
  };
}

function prowplusManifest() {
  return buildManifest({
    name: BRAND_NAME,
    shortName: BRAND_SHORT,
    description: BRAND_DESCRIPTION,
    icons: PROWPLUS_ICONS,
  });
}

function companyManifest(company) {
  const name = company.name;
  const icons = [...PROWPLUS_ICONS];
  if (isUsableLogoUrl(company.logoUrl)) {
    const src = company.logoUrl.trim();
    const entry = { src, purpose: 'any' };
    const type = guessImageType(src);
    if (type) entry.type = type;
    // Company logos are rarely a known square PNG we control — no fake sizes.
    icons.unshift(entry);
  }

  return buildManifest({
    name,
    shortName: truncatePwaShortName(name),
    description: `${name} workspace on ${NEUTRAL_BRAND_NAME}`,
    icons,
  });
}

export async function GET() {
  const jar = await cookies();
  const company = parsePwaBrandCookie(jar.get(PWA_BRAND_COOKIE)?.value);
  const manifest = company ? companyManifest(company) : prowplusManifest();

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
