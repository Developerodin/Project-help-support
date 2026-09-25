/* ProwPlus PWA service worker — app-shell / static assets only.
 *
 * Caching policy:
 * - Navigations (HTML): network-first → offline.html on failure. Never cache
 *   authenticated document responses (avoids stale private shells / session leak).
 * - /manifest.webmanifest: never cache (varies by brand cookie).
 * - /_next/static/*: cache-first (content-hashed; safe to keep).
 * - Same-origin static under /icons/, /branding/, offline.html: cache-first after
 *   first fetch; offline.html is precached. Company logos are not cached (shared
 *   device leak risk); only fixed ProwPlus brand/icon paths are.
 * - Everything else (API, auth, SWR JSON): network only — not cached.
 *
 * Updates: install skipWaiting + activate clients.claim so the new SW controls
 * clients without wiping cookies/localStorage. No forced reload — the next full
 * navigation picks up fresh HTML and hashed assets (avoids reload loops).
 */

const VERSION = 'prowplus-pwa-v4';
const PRECACHE = `${VERSION}-precache`;
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE_URLS = [
  '/offline.html',
  '/branding/pp_icons.png',
  '/icons/icon-192-prowplus.png',
  '/icons/apple-touch-prowplus.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== PRECACHE && key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

function isHashedNextStatic(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
}

function isSameOriginStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/manifest.webmanifest') return false;
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/branding/')) return true;
  if (url.pathname === '/offline.html') return true;
  // Fonts only — do not cache arbitrary images (company logos on shared devices).
  return /\.(?:woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (API, CDNs): never intercept.
  if (url.origin !== self.location.origin) return;

  // Auth/API-shaped paths on the frontend origin — do not cache.
  if (url.pathname.startsWith('/api/')) return;

  // Dynamic brand manifest — always network, never cache.
  if (url.pathname === '/manifest.webmanifest') return;

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isHashedNextStatic(url) || isSameOriginStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

async function networkFirstNavigation(request) {
  try {
    const fresh = await fetch(request);
    return fresh;
  } catch {
    const cached = await caches.match('/offline.html');
    return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/* Web push. The server sends { title, body, url, tag } for each in-app
 * notification (backend notifications/push.service.js). Every push must show a
 * notification: browsers revoke permission from workers that stay silent. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'ProwPlus', {
      body: data.body || '',
      icon: '/icons/icon-192-prowplus.png',
      badge: '/icons/icon-192-prowplus.png',
      tag: data.tag,
      // A replaced banner (same ticket) still alerts; without a tag nothing is replaced.
      renotify: Boolean(data.tag),
      data: { url: data.url || '/notifications' },
    }),
  );
});

// Tapping opens the ticket: reuse an open app window when there is one, else open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ('navigate' in open) await open.navigate(target.href);
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
