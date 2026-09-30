import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Ticket from '../ticket.model.js';

withMemoryDb();

const base = (over = {}) => ({
  ticketId: 'WEB-1',
  project: new mongoose.Types.ObjectId(),
  title: 'Login button does nothing',
  createdBy: new mongoose.Types.ObjectId(),
  ...over,
});

test('a minimal ticket saves with pipeline defaults', async () => {
  const ticket = await Ticket.create(base());

  assert.equal(ticket.status, 'pending');
  assert.equal(ticket.revision, 0);
  assert.equal(ticket.blocked, false);
  assert.equal(ticket.reopenCount, 0);
  assert.equal(ticket.stageHistory.length, 0);
});

test('only ticketId, project, title and createdBy are required', async () => {
  // Everything Part B adds is enforced in the SERVICE layer, so a legacy
  // document with null estimates and empty history imports cleanly.
  const required = Object.entries(Ticket.schema.paths)
    .filter(([, path]) => path.isRequired)
    .map(([name]) => name)
    .sort();

  assert.deepEqual(required, ['createdBy', 'project', 'ticketId', 'title']);
});

test('ticketId is unique and stored verbatim', async () => {
  await Ticket.create(base({ ticketId: 'DEV-MSIN0F6Q-0BFD8854' }));
  assert.equal((await Ticket.findOne({})).ticketId, 'DEV-MSIN0F6Q-0BFD8854');

  await Ticket.init();
  await assert.rejects(
    () => Ticket.create(base({ ticketId: 'DEV-MSIN0F6Q-0BFD8854' })),
    (err) => err.code === 11000,
  );
});

test('status only accepts stage keys', async () => {
  await assert.rejects(() => Ticket.create(base({ status: 'Resolved' })));
  const ok = await Ticket.create(base({ status: 'qa_approved' }));
  assert.equal(ok.status, 'qa_approved');
});

test('attachments store a key and never a url', async () => {
  const ticket = await Ticket.create(base({
    attachments: [{
      key: 'tickets/abc/1700000000-xyz.png',
      name: '../../etc/passwd.png',
      size: 10,
      mimeType: 'image/png',
      uploadedBy: new mongoose.Types.ObjectId(),
      url: 'https://example.com/leaked',
    }],
  }));

  assert.equal(ticket.attachments[0].key, 'tickets/abc/1700000000-xyz.png');
  assert.equal(ticket.attachments[0].url, undefined, 'url is not a schema path');
});

test('toJSON exposes id and revision and hides __v', async () => {
  const json = (await Ticket.create(base())).toJSON();

  assert.ok(json.id);
  assert.equal(json._id, undefined);
  assert.equal(json.__v, undefined);
  assert.equal(json.revision, 0);
});
