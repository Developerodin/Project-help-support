import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as hub from '../realtime-hub.js';

beforeEach(() => {
  hub.resetForTests();
});
import {
  discussionAudienceUserIds,
  publishTicketCommentRealtime,
  publishTicketUpdatedRealtime,
} from '../realtime.service.js';

function mockResponse() {
  const chunks = [];
  return {
    chunks,
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
  };
}

test('discussionAudienceUserIds includes raiser, tester and watchers, not actor', () => {
  const ticket = {
    createdBy: 'user-a',
    testedBy: 'user-b',
    watchers: ['user-w', { _id: 'user-a' }],
    ticketId: 'WEB-1',
    project: 'proj-1',
  };
  const ids = discussionAudienceUserIds(ticket, 'user-c');
  assert.deepEqual(ids.sort(), ['user-a', 'user-b', 'user-w']);
  assert.deepEqual(discussionAudienceUserIds(ticket, 'user-a'), ['user-b', 'user-w']);
});

test('a watcher who is neither raiser nor tester still gets the comment event', () => {
  const res = mockResponse();
  hub.subscribe({ res, userId: 'user-w', projectId: 'proj-1' });

  publishTicketCommentRealtime(
    { ticketId: 'WEB-4', project: 'proj-1', createdBy: 'user-a', watchers: ['user-w'] },
    { _id: 'user-a', name: 'Dana Reed' },
  );

  assert.equal(res.chunks.length, 1);
  assert.match(res.chunks[0], /WEB-4/);
  // The popup says who replied, so the name has to survive the wire.
  assert.equal(JSON.parse(res.chunks[0].replace('data: ', '')).actorName, 'Dana Reed');
});

test('publishTicketCommentRealtime targets discussion audience only', () => {
  const res = mockResponse();
  hub.subscribe({ res, userId: 'user-a', projectId: 'proj-1' });
  hub.subscribe({ res: mockResponse(), userId: 'user-x', projectId: 'proj-1' });

  publishTicketCommentRealtime(
    { ticketId: 'WEB-9', project: 'proj-1', createdBy: 'user-a', testedBy: 'user-b' },
    { _id: 'user-c' },
  );

  assert.equal(res.chunks.length, 1);
  assert.match(res.chunks[0], /ticket\.comment/);
  assert.match(res.chunks[0], /WEB-9/);
});

test('publishTicketUpdatedRealtime targets project subscribers', () => {
  const res = mockResponse();
  hub.subscribe({ res, userId: 'user-z', projectId: 'proj-2' });
  hub.subscribe({ res: mockResponse(), userId: 'user-z', projectId: 'other' });

  publishTicketUpdatedRealtime(
    { ticketId: 'WEB-2', project: 'proj-2', createdBy: 'user-a' },
    { _id: 'user-z' },
  );

  assert.equal(res.chunks.length, 0);

  publishTicketUpdatedRealtime(
    { ticketId: 'WEB-2', project: 'proj-2', createdBy: 'user-a' },
    { _id: 'user-actor' },
  );
  assert.equal(res.chunks.length, 1);
  assert.match(res.chunks[0], /ticket\.updated/);
  // The project channel takes any ?project= without an authorization check, so
  // the payload must not name a ticket.
  assert.doesNotMatch(res.chunks[0], /WEB-2/);
});

test('userClientCount counts one user\'s streams and closeAll ends every stream', () => {
  const ended = [];
  const res = (id) => ({ ...mockResponse(), end() { ended.push(id); } });
  hub.subscribe({ res: res('a1'), userId: 'u1', projectId: null });
  hub.subscribe({ res: res('a2'), userId: 'u1', projectId: null });
  hub.subscribe({ res: res('b1'), userId: 'u2', projectId: null });
  assert.equal(hub.userClientCount('u1'), 2);
  assert.equal(hub.userClientCount('u3'), 0);

  hub.closeAll();
  assert.deepEqual(ended.sort(), ['a1', 'a2', 'b1']);
  assert.equal(hub.clientCount(), 0);
});
