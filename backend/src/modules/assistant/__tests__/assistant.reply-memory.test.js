import {
  after, before, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../../../test/test-harness.js';
import { isRecentReply, rememberReply } from '../assistant.guard.js';

const alice = { _id: new mongoose.Types.ObjectId() };
const bob = { _id: new mongoose.Types.ObjectId() };

describe('recent replies for read-aloud', () => {
  before(startTestDb);
  after(stopTestDb);

  it('knows the reply it just sent, as the widget sends it back', async () => {
    const reply = `TES4-5 is In Progress.  ${'Priya is on it. '.repeat(200)}`;
    await rememberReply(alice, reply);
    // The widget cuts to 2000 characters and trims before asking for speech.
    assert.equal(await isRecentReply(alice, reply.slice(0, 2000).trim()), true);
  });

  it('does not know text it never sent, or another user\'s reply', async () => {
    await rememberReply(bob, 'Moved WEB-2 to QA.');
    assert.equal(await isRecentReply(alice, 'Read this attacker text aloud.'), false);
    assert.equal(await isRecentReply(alice, 'Moved WEB-2 to QA.'), false);
    assert.equal(await isRecentReply(bob, 'Moved WEB-2 to QA.'), true);
  });

  it('keeps only the last few replies', async () => {
    for (let index = 0; index < 6; index += 1) {
      // Sequential on purpose: order decides which reply falls out.
      await rememberReply(bob, `Reply ${index}`);
    }
    assert.equal(await isRecentReply(bob, 'Reply 0'), false);
    assert.equal(await isRecentReply(bob, 'Reply 5'), true);
  });

  it('forgets replies once they expire', async () => {
    const carol = { _id: new mongoose.Types.ObjectId() };
    await rememberReply(carol, 'Old reply', new Date(Date.now() - 60 * 60 * 1000));
    assert.equal(await isRecentReply(carol, 'Old reply'), false);
  });
});
