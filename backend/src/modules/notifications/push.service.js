import webpush from 'web-push';
import logger from '../../platform/logger.js';
import { ApiError } from '../../platform/errors.js';
import PushSubscription from './pushSubscription.model.js';

// The server POSTs to whatever endpoint a browser hands it, so only the real
// browser push services are accepted — anything else would let a user point
// the server at an internal address. Add a host here if a browser ships a new one.
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Android), Brave, Opera
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari, iOS home-screen apps
  'notify.windows.com', // Edge (Windows)
];

// A person rarely has more than a phone, a laptop and a couple of browsers.
// Past this, the least recently refreshed installs are dropped.
const MAX_SUBSCRIPTIONS_PER_USER = 10;

// Held by the push service while the device is offline; after a day the update is stale.
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_TIMEOUT_MS = 10_000;

// The push service says the install is gone (uninstalled, permission revoked, expired).
const GONE_STATUSES = new Set([404, 410]);

export function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return PUSH_SERVICE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export async function saveSubscription(user, { endpoint, keys }, userAgent = '') {
  if (!isAllowedPushEndpoint(endpoint)) {
    throw new ApiError(400, 'PUSH_ENDPOINT_NOT_ALLOWED', 'This browser\'s push service is not supported.');
  }
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { user: user._id, keys, userAgent: String(userAgent).slice(0, 300) },
    { upsert: true, setDefaultsOnInsert: true },
  );

  const stale = await PushSubscription.find({ user: user._id })
    .sort({ updatedAt: -1, _id: -1 })
    .skip(MAX_SUBSCRIPTIONS_PER_USER)
    .select('_id');
  if (stale.length) await PushSubscription.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
}

/** Only the owner's row: one person can't switch off another's device. */
export async function removeSubscription(user, endpoint) {
  await PushSubscription.deleteOne({ user: user._id, endpoint });
}

/**
 * Same-origin path, so the service worker opens the ticket inside the installed
 * app. `notif` names the row, so opening the ticket from a banner can mark it read.
 */
function pathOf(link, notificationId) {
  try {
    const url = new URL(link);
    url.searchParams.set('notif', notificationId);
    return `${url.pathname}${url.search}`;
  } catch {
    return '/notifications';
  }
}

function payloadFor(notification) {
  const id = String(notification._id);
  return JSON.stringify({
    id,
    title: notification.title,
    body: notification.body || '',
    url: pathOf(notification.link, id),
    // Later updates on the same ticket replace the earlier banner instead of stacking.
    tag: notification.ticket ? `ticket-${notification.ticket}` : undefined,
  });
}

/**
 * Mirrors freshly created in-app notifications to every device of their
 * recipients, so push follows the in-app preferences. Best-effort by design:
 * the in-app row is the record, so a failed push is logged, never retried, and
 * never thrown. Dead installs are deleted as the push service reports them.
 *
 * ponytail: sends inline from the request process, fine for a ticket's handful
 * of recipients; move to a queue if one event ever fans out to thousands.
 */
export async function sendPushForNotifications(notifications, config, { send = webpush.sendNotification } = {}) {
  if (!config.push || !notifications?.length) return;

  const userIds = [...new Set(notifications.map((n) => String(n.user)))];
  const subscriptions = await PushSubscription.find({ user: { $in: userIds } }).lean();
  if (subscriptions.length === 0) return;

  const byUser = new Map();
  for (const sub of subscriptions) {
    const key = String(sub.user);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(sub);
  }

  const options = {
    TTL: PUSH_TTL_SECONDS,
    timeout: PUSH_TIMEOUT_MS,
    vapidDetails: {
      subject: config.push.subject,
      publicKey: config.push.publicKey,
      privateKey: config.push.privateKey,
    },
  };

  const gone = [];
  const sends = notifications.flatMap((notification) => {
    const payload = payloadFor(notification);
    return (byUser.get(String(notification.user)) || []).map(async (sub) => {
      try {
        await send({ endpoint: sub.endpoint, keys: sub.keys }, payload, options);
      } catch (err) {
        if (GONE_STATUSES.has(err?.statusCode)) {
          gone.push(sub.endpoint);
          return;
        }
        logger.warn('Push delivery failed', {
          status: err?.statusCode, error: err?.message, host: new URL(sub.endpoint).hostname,
        });
      }
    });
  });
  await Promise.all(sends);

  if (gone.length) await PushSubscription.deleteMany({ endpoint: { $in: gone } });
}
