import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import PushSubscription from '../pushSubscription.model.js';
import { deleteTicket } from '../../tickets/ticket.service.js';
import { revokeAllRefreshTokens } from '../../auth/token.service.js';
import { updateUser } from '../../users/user.service.js';

withMemoryDb();

const user = (role = ROLE_IDS.DEVELOPER) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

const subscribe = (u, name) => PushSubscription.create({
  user: u._id, endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'p', auth: 'a' },
});

test('deleting a ticket deletes its notifications and nothing else', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: admin._id });
  const [gone, kept] = await Ticket.create([
    { ticketId: 'WEB-1', project: project._id, title: 'a', createdBy: admin._id },
    { ticketId: 'WEB-2', project: project._id, title: 'b', createdBy: admin._id },
  ]);
  await Notification.create([
    { user: admin._id, event: 'TICKET_CREATED', ticket: gone._id, title: 't' },
    { user: admin._id, event: 'TICKET_CREATED', ticket: kept._id, title: 't' },
  ]);

  await deleteTicket(String(gone._id), admin);

  assert.equal(await Notification.countDocuments({ ticket: gone._id }), 0);
  assert.equal(await Notification.countDocuments({ ticket: kept._id }), 1);
});

test('signing someone out everywhere also removes their push devices', async () => {
  const [ada, bo] = [await user(), await user()];
  await subscribe(ada, 'ada');
  await subscribe(bo, 'bo');

  await revokeAllRefreshTokens(ada._id);

  assert.equal(await PushSubscription.countDocuments({ user: ada._id }), 0);
  assert.equal(await PushSubscription.countDocuments({ user: bo._id }), 1);
});

test('deactivating a user removes their push devices', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const ada = await user();
  await subscribe(ada, 'ada');

  await updateUser(admin, String(ada._id), { status: 'inactive' });

  assert.equal(await PushSubscription.countDocuments({ user: ada._id }), 0);
});
