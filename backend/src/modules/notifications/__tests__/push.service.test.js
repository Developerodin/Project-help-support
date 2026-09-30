import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import PushSubscription from '../pushSubscription.model.js';
import {
  isAllowedPushEndpoint, removeSubscription, saveSubscription, sendPushForNotifications,
} from '../push.service.js';

withMemoryDb();

const config = { push: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@example.com' } };
const keys = { p256dh: 'p', auth: 'a' };
const endpoint = (n) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const person = () => ({ _id: new mongoose.Types.ObjectId() });

test('only real browser push services are accepted as endpoints', () => {
  assert.ok(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(isAllowedPushEndpoint('https://web.push.apple.com/abc'));
  assert.ok(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(isAllowedPushEndpoint('https://wns2-by3p.notify.windows.com/w/?token=x'));
  assert.ok(!isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/x'));
  assert.ok(!isAllowedPushEndpoint('https://169.254.169.254/latest'));
  assert.ok(!isAllowedPushEndpoint('https://evilpush.apple.com.attacker.net/x'));
  assert.ok(!isAllowedPushEndpoint('not a url'));
});

test('a browser that re-subscribes under another login moves to that user', async () => {
  const [ada, bo] = [person(), person()];
  await saveSubscription(ada, { endpoint: endpoint(1), keys });
  await saveSubscription(bo, { endpoint: endpoint(1), keys });
  const rows = await PushSubscription.find({ endpoint: endpoint(1) });
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].user), String(bo._id));
});

test('a user keeps at most ten devices, newest first', async () => {
  const ada = person();
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await saveSubscription(ada, { endpoint: endpoint(`cap-${i}`), keys });
  }
  const rows = await PushSubscription.find({ user: ada._id });
  assert.equal(rows.length, 10);
  assert.ok(!rows.some((r) => r.endpoint === endpoint('cap-0')));
});

test('removing a subscription only touches the caller\'s own device', async () => {
  const [ada, bo] = [person(), person()];
  await saveSubscription(ada, { endpoint: endpoint('own'), keys });
  await removeSubscription(bo, endpoint('own'));
  assert.equal(await PushSubscription.countDocuments({ endpoint: endpoint('own') }), 1);
  await removeSubscription(ada, endpoint('own'));
  assert.equal(await PushSubscription.countDocuments({ endpoint: endpoint('own') }), 0);
});

test('each notification reaches every device of its recipient, and dead devices are pruned', async () => {
  const [ada, bo] = [person(), person()];
  await saveSubscription(ada, { endpoint: endpoint('a1'), keys });
  await saveSubscription(ada, { endpoint: endpoint('a2-gone'), keys });
  await saveSubscription(bo, { endpoint: endpoint('b1-flaky'), keys });

  const sent = [];
  const send = async (sub, payload, options) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
    if (sub.endpoint.includes('gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    if (sub.endpoint.includes('flaky')) throw Object.assign(new Error('Busy'), { statusCode: 503 });
  };

  const ticket = new mongoose.Types.ObjectId();
  const adaNotification = new mongoose.Types.ObjectId();
  await sendPushForNotifications([
    { _id: adaNotification, user: ada._id, ticket, title: 'Asha assigned WEB-1 to you', body: 'Broken login', link: 'https://app.example.com/tickets?ticket=WEB-1&project=p' },
    { _id: new mongoose.Types.ObjectId(), user: bo._id, ticket, title: 'Asha assigned WEB-1 to Ada', body: '', link: 'https://app.example.com/tickets?ticket=WEB-1' },
  ], config, { send });

  assert.deepEqual(sent.map((s) => s.endpoint).sort(), [endpoint('a1'), endpoint('a2-gone'), endpoint('b1-flaky')].sort());
  const toAda = sent.find((s) => s.endpoint === endpoint('a1'));
  assert.equal(toAda.payload.url, `/tickets?ticket=WEB-1&project=p&notif=${adaNotification}`);
  assert.equal(toAda.payload.id, String(adaNotification));
  assert.equal(toAda.payload.tag, `ticket-${ticket}`);
  assert.equal(toAda.options.vapidDetails.subject, 'mailto:ops@example.com');

  // 410 means the install is gone; a 503 is transient and keeps the device.
  assert.equal(await PushSubscription.countDocuments({ endpoint: endpoint('a2-gone') }), 0);
  assert.equal(await PushSubscription.countDocuments({ endpoint: endpoint('b1-flaky') }), 1);
});

test('nothing is sent when push is not configured', async () => {
  const ada = person();
  await saveSubscription(ada, { endpoint: endpoint('off'), keys });
  let calls = 0;
  await sendPushForNotifications(
    [{ _id: new mongoose.Types.ObjectId(), user: ada._id, title: 't', link: '/x' }],
    { push: null },
    { send: async () => { calls += 1; } },
  );
  assert.equal(calls, 0);
});
