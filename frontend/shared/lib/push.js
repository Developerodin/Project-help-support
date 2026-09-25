import { getPushConfig, removePushSubscription, savePushSubscription } from '@/shared/api/notifications.js';

/**
 * Web push on this device. Push is "on" when the browser holds a subscription
 * and notification permission is granted; the server keeps one row per device.
 *
 * Status values:
 * - 'unsupported'   browser has no web push
 * - 'needs-install' iPhone/iPad in a Safari tab: push exists only in the home-screen app
 * - 'no-worker'     no service worker (it is only registered in production builds)
 * - 'denied'        the person blocked notifications for this site
 * - 'off' / 'on'
 */

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function keyBytes(base64Url) {
  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function sameKey(buffer, bytes) {
  if (!buffer) return false;
  const current = new Uint8Array(buffer);
  return current.length === bytes.length && current.every((b, i) => b === bytes[i]);
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushStatus() {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'no-worker';
  const subscription = await reg.pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

/**
 * Subscribes this device. Must run from a tap: iOS only shows the permission
 * prompt in response to one. A subscription made with an old server key (after
 * VAPID keys were rotated) is replaced, or the server could never reach it.
 */
export async function enablePush() {
  const config = await getPushConfig();
  if (!config?.enabled) throw new Error('Push notifications are not set up on the server.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed for this site.');

  const reg = await registration();
  if (!reg) throw new Error('Push is not available in this build.');

  const serverKey = keyBytes(config.publicKey);
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, serverKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
  await savePushSubscription(subscription.toJSON());
}

/**
 * Unsubscribes this device. The browser-side unsubscribe is what matters: even
 * if telling the server fails, the next push to this endpoint gets a 410 and
 * the server drops the row itself.
 */
export async function disablePush() {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await removePushSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}

/**
 * On sign-in: re-links an existing subscription to whoever is signed in now,
 * and refreshes it if the browser rotated it. Never subscribes on its own.
 */
export async function syncPush() {
  if ((await pushStatus()) !== 'on') return;
  const config = await getPushConfig();
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  if (!config?.enabled) return;
  if (!sameKey(subscription.options?.applicationServerKey, keyBytes(config.publicKey))) {
    await enablePush();
    return;
  }
  await savePushSubscription(subscription.toJSON());
}

/** Bounded, so a hung push service can't stall logout. */
export function disablePushQuietly(timeoutMs = 3000) {
  return Promise.race([
    disablePush().catch(() => {}),
    new Promise((resolve) => { setTimeout(resolve, timeoutMs); }),
  ]);
}
