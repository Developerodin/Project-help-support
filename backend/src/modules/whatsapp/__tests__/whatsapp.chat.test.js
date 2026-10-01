import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { WHATSAPP_TOOLS, runTool } from '../../assistant/assistant.tools.js';
import {
  REPLIES, answer, startLink, toWhatsapp, unlink,
} from '../whatsapp.service.js';
import { handle } from '../whatsapp.route.js';
import { WhatsappLink, WhatsappState } from '../whatsapp.model.js';
import RbacAuditLog from '../../rbac/rbacAuditLog.model.js';

/*
 * WhatsApp is the assistant with no login screen in front of it, so these pin
 * the parts that stand in for one: who the sender is, that they are still
 * active, and that a client's chat stays inside what they see in the app.
 */

withMemoryDb();

const config = {
  storage: null,
  features: { attachments: true },
  whatsapp: { token: 't', phoneNumberId: '1' },
  assistant: {
    apiKey: 'sk-test', chatModel: 'm', userDailyBudgetInr: 100, usdToInr: 88, budgetTimeZone: 'Asia/Kolkata',
    monthlyTokenBudget: 1_000_000, prices: { chatInputPerM: 1, chatOutputPerM: 1, transcribePerMin: 1, speechPerMin: 1 },
  },
};

let seq = 0;
const text = (body) => ({ id: `wamid.${seq += 1}`, type: 'text', text: { body } });
const sender = { waId: '919800000001', bsuid: 'IN.1' };
const user = (role, extra = {}) => User.create({
  name: role, email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role, roles: [role], status: 'active', ...extra,
});

async function linked(actor) {
  const { code } = await startLink(actor);
  return answer(config, sender, text(`LINK ${code}`));
}

/**
 * Fakes fetch with `fake`, except Meta's messages endpoint (typing, read receipts,
 * replies), which is answered here so no fake sees it: 200, or 500 for a payload
 * `refuse` picks. Returns the payloads sent there.
 */
function mockFetch(t, fake, { refuse = () => false } = {}) {
  const typed = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://graph.facebook.com/') && href.endsWith(`/${config.whatsapp.phoneNumberId}/messages`)) {
      const payload = JSON.parse(init.body);
      typed.push(payload);
      return new Response('{}', { status: refuse(payload) ? 500 : 200 });
    }
    return fake(url, init);
  });
  return typed;
}

/** Fails the test if the model is called at all. */
const noModel = (t) => mockFetch(t, async () => { throw new Error('model must not be called'); });

test('an unlinked sender is told how to link, and the model is never called', async (t) => {
  noModel(t);
  assert.equal(await answer(config, sender, text('status of WEB-1?')), REPLIES.notLinked);
});

test('a link code works once, from the sender who sends it, and then expires', async () => {
  const actor = await user(ROLE_IDS.DEVELOPER, { name: 'Asha' });
  const { code } = await startLink(actor);

  assert.match(await answer(config, sender, text(`link ${code}`)), /^Linked to Asha\./);
  const link = await WhatsappLink.findOne({ user: actor._id }).lean();
  assert.equal(link.waId, sender.waId);
  assert.equal(link.bsuid, sender.bsuid);

  // Single use: the same code from another phone does nothing.
  assert.equal(await answer(config, { waId: '919800000002' }, text(`LINK ${code}`)), REPLIES.badCode);
  assert.equal(await WhatsappLink.countDocuments(), 1);

  const [audit] = await RbacAuditLog.find({ action: 'whatsapp.linked' }).lean();
  assert.equal(audit.category, 'whatsapp');
  assert.equal(String(audit.actor), String(actor._id));
  assert.equal(audit.details.waId, sender.waId);
  assert.ok(audit.createdAt);
});

test('a link unused for 90 days is dropped, so a reassigned number does not inherit the account', async (t) => {
  noModel(t);
  const actor = await user(ROLE_IDS.DEVELOPER);
  await linked(actor);
  const stale = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
  await WhatsappLink.updateOne({ user: actor._id }, { $set: { lastUsedAt: stale, linkedAt: stale } });

  assert.equal(await answer(config, sender, text('status of WEB-1?')), REPLIES.notLinked);
  assert.equal(await WhatsappLink.countDocuments({ user: actor._id }), 0);
  const audit = await RbacAuditLog.findOne({ action: 'whatsapp.unlinked', 'details.reason': 'idle' }).lean();
  assert.equal(audit.details.userId, String(actor._id));
});

test('guessing codes is cut off after five wrong tries, and the block is audited once', async () => {
  const actor = await user(ROLE_IDS.DEVELOPER);
  for (let i = 0; i < 5; i += 1) assert.equal(await answer(config, sender, text('LINK 00000000')), REPLIES.badCode);
  // Even the right code is refused now.
  const { code } = await startLink(actor);
  assert.equal(await answer(config, sender, text(`LINK ${code}`)), REPLIES.tooManyTries);

  const rows = await RbacAuditLog.find({ action: 'whatsapp.link_blocked' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, null, 'no account is behind the guesses');
  assert.equal(rows[0].details.waId, sender.waId);
  assert.equal(rows[0].details.attempts, 5);
});

test('moving a number to another account audits the unlink and the new link', async () => {
  const first = await user(ROLE_IDS.DEVELOPER, { name: 'First' });
  const second = await user(ROLE_IDS.DEVELOPER, { name: 'Second' });
  await linked(first);
  await linked(second);

  const unlinked = await RbacAuditLog.findOne({ action: 'whatsapp.unlinked' }).lean();
  assert.equal(unlinked.details.reason, 'replaced');
  assert.equal(String(unlinked.targetUser), String(first._id));
  assert.equal(String(unlinked.actor), String(second._id));
  assert.equal(await RbacAuditLog.countDocuments({ action: 'whatsapp.linked' }), 2);
});

test('unlinking from the profile is audited with the number', async () => {
  const actor = await user(ROLE_IDS.DEVELOPER);
  await linked(actor);
  await unlink(actor, { ip: '127.0.0.1' });
  await unlink(actor);

  const rows = await RbacAuditLog.find({ action: 'whatsapp.unlinked' }).lean();
  assert.equal(rows.length, 1, 'nothing to audit once it is gone');
  assert.equal(rows[0].details.reason, 'profile');
  assert.equal(rows[0].details.waId, sender.waId);
  assert.equal(rows[0].details.ip, '127.0.0.1');
  assert.equal(await WhatsappLink.countDocuments(), 0);
});

test('an unlinked number is audited once a day, without what it said', async (t) => {
  noModel(t);
  assert.equal(await answer(config, sender, text('secret question about WEB-1')), REPLIES.notLinked);
  assert.equal(await answer(config, sender, text('another one')), REPLIES.notLinked);

  const rows = await RbacAuditLog.find({ action: 'whatsapp.unknown_sender' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, null);
  assert.equal(rows[0].details.waId, sender.waId);
  assert.equal(rows[0].details.type, 'text');
  assert.doesNotMatch(JSON.stringify(rows[0]), /secret|another/);
});

test('a deactivated user loses WhatsApp at once, without the model being called', async (t) => {
  const actor = await user(ROLE_IDS.DEVELOPER);
  await linked(actor);
  await User.updateOne({ _id: actor._id }, { status: 'inactive' });
  noModel(t);
  assert.equal(await answer(config, sender, text('my tickets?')), REPLIES.inactive);
});

test('Meta redelivering a message gets no second answer', async (t) => {
  noModel(t);
  const message = text('hello');
  assert.equal(await answer(config, sender, message), REPLIES.notLinked);
  assert.equal(await answer(config, sender, message), null);
});

test('a linked user\'s message shows "typing" and is marked read; an unlinked number or a link code gets neither', async (t) => {
  const typed = mockFetch(t, async () => new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'You have no open tickets.' }] }],
  }), { status: 200 }));

  assert.equal(await answer(config, sender, text('my tickets?')), REPLIES.notLinked);
  await linked(await user(ROLE_IDS.ADMIN));
  assert.deepEqual(typed, []);

  const message = text('my tickets?');
  assert.equal(await answer(config, sender, message), 'You have no open tickets.');
  assert.deepEqual(typed, [{
    messaging_product: 'whatsapp', status: 'read', message_id: message.id, typing_indicator: { type: 'text' },
  }]);
});

describe('read receipts on the webhook path', () => {
  const modelSays = (said) => async () => new Response(JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', text: said }] }],
  }), { status: 200 });
  const value = { metadata: { phone_number_id: config.whatsapp.phoneNumberId }, contacts: [{ wa_id: sender.waId, user_id: sender.bsuid }] };
  const incoming = (body) => ({ ...text(body), from: sender.waId });
  const typingFor = (message) => ({
    messaging_product: 'whatsapp', status: 'read', message_id: message.id, typing_indicator: { type: 'text' },
  });
  const readFor = (message) => ({ messaging_product: 'whatsapp', status: 'read', message_id: message.id });
  const replyOf = (body) => ({ messaging_product: 'whatsapp', to: sender.waId, type: 'text', text: { body } });

  test('an unlinked number gets its reply but stays unread', async (t) => {
    const typed = mockFetch(t, async () => { throw new Error('model must not be called'); });
    await handle(config, value, incoming('status of WEB-1?'));
    assert.deepEqual(typed, [replyOf(REPLIES.notLinked)]);
  });

  test('a linked message is marked read with "typing", and not again after the reply', async (t) => {
    await linked(await user(ROLE_IDS.ADMIN));
    const typed = mockFetch(t, modelSays('You have no open tickets.'));
    const message = incoming('my tickets?');
    await handle(config, value, message);
    assert.deepEqual(typed, [typingFor(message), replyOf('You have no open tickets.')]);
  });

  test('if Meta refuses "typing", the message is still marked read at once', async (t) => {
    await linked(await user(ROLE_IDS.ADMIN));
    const typed = mockFetch(t, modelSays('You have no open tickets.'), { refuse: (p) => Boolean(p.typing_indicator) });
    const message = incoming('my tickets?');
    await handle(config, value, message);
    assert.deepEqual(typed, [typingFor(message), readFor(message), replyOf('You have no open tickets.')]);
  });

  test('if no read receipt landed while answering, the message is marked read once the reply is out', async (t) => {
    await linked(await user(ROLE_IDS.ADMIN));
    let receiptsRefused = 2;
    const typed = mockFetch(t, modelSays('You have no open tickets.'), {
      refuse: (p) => p.status === 'read' && (receiptsRefused -= 1) >= 0,
    });
    const message = incoming('my tickets?');
    await handle(config, value, message);
    assert.deepEqual(typed, [typingFor(message), readFor(message), replyOf('You have no open tickets.'), readFor(message)]);
  });

  test('a message to another number on the same Meta app is left alone', async (t) => {
    await linked(await user(ROLE_IDS.ADMIN));
    const typed = mockFetch(t, async () => { throw new Error('model must not be called'); });
    await handle(config, { ...value, metadata: { phone_number_id: 'someone-else' } }, incoming('my tickets?'));
    assert.deepEqual(typed, []);
  });

  test('a reaction to a reply gets no answer and no read receipt', async (t) => {
    await linked(await user(ROLE_IDS.ADMIN));
    const typed = mockFetch(t, async () => { throw new Error('model must not be called'); });
    await handle(config, value, {
      id: `wamid.${seq += 1}`, from: sender.waId, type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' },
    });
    assert.deepEqual(typed, []);
  });

  test('a reply Meta refuses leaves an unread message unread', async (t) => {
    await linked(await user(ROLE_IDS.ADMIN));
    const typed = mockFetch(t, modelSays('You have no open tickets.'), { refuse: () => true });
    const message = incoming('my tickets?');
    await handle(config, value, message);
    assert.deepEqual(typed, [typingFor(message), readFor(message), replyOf('You have no open tickets.')]);
  });
});

test('WhatsApp offers lookups and new tickets only, and refuses any other write tool named anyway', async (t) => {
  const admin = await user(ROLE_IDS.ADMIN);
  await linked(admin);

  const offered = [];
  const replies = [
    { output: [{ type: 'function_call', name: 'propose_comment', call_id: 'c1', arguments: '{"ticket_id":"X-1","content":"hi","internal":null}' }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] },
  ];
  const bodies = [];
  mockFetch(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    offered.push(...body.tools.map((tool) => tool.name));
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  });

  await answer(config, sender, text('comment hi on X-1'));
  assert.ok(offered.length > 0);
  assert.deepEqual(offered.filter((name) => !WHATSAPP_TOOLS.has(name)), []);
  const output = bodies[1].input.find((item) => item.type === 'function_call_output');
  assert.match(JSON.parse(output.output).error, /not available on WhatsApp/);
});

test('a linked client reads only their own project over WhatsApp', async (t) => {
  const admin = await user(ROLE_IDS.ADMIN);
  const companyA = await Client.create({ name: 'Company A', createdBy: admin._id });
  const companyB = await Client.create({ name: 'Company B', createdBy: admin._id });
  const a1 = await Project.create({ key: 'A1', name: 'A One', client: companyA._id, createdBy: admin._id });
  const b1 = await Project.create({ key: 'B1', name: 'B One', client: companyB._id, createdBy: admin._id });
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  await AccessAssignment.create({
    user: tester._id, role: ROLE_IDS.CLIENT_TESTER, client: companyA._id, project: a1._id, grantedBy: admin._id,
  });
  await Ticket.create({
    ticketId: 'B1-1', project: b1._id, title: 'Other company ticket', createdBy: admin._id,
    severity: 'Minor', priority: 'Low', status: 'pending',
  });
  await linked(tester);

  const replies = [
    { output: [{ type: 'function_call', name: 'get_ticket', call_id: 'c1', arguments: '{"ticket_id":"B1-1"}' }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: 'I can only see your own projects.' }] }] },
  ];
  const bodies = [];
  mockFetch(t, async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  });

  await answer(config, sender, text('what is B1-1?'));
  const output = JSON.parse(bodies[1].input.find((item) => item.type === 'function_call_output').output);
  // The same "not found" a missing ticket gives: B1-1's existence isn't confirmed.
  assert.deepEqual(output, await runTool('get_ticket', '{"ticket_id":"ZZ-404"}', {
    config, user: tester, permissionContext: null, actions: [], projects: null, clients: null,
  }));
  assert.doesNotMatch(bodies[1].input.map((item) => item.output ?? '').join(' '), /Other company ticket/);
});

/** The model drafts a ticket on the first call, then answers with `say` on every later call. */
function draftingModel(t, draft, say = 'Reply *yes* to create it or *no* to cancel.') {
  const calls = { count: 0 };
  const replies = [{ output: [{ type: 'function_call', name: 'propose_create_ticket', call_id: 'c1', arguments: JSON.stringify(draft) }] }];
  mockFetch(t, async () => {
    calls.count += 1;
    const next = replies.shift() ?? { output: [{ type: 'message', content: [{ type: 'output_text', text: say }] }] };
    return new Response(JSON.stringify(next), { status: 200 });
  });
  return calls;
}

const ticketDraft = (projectKey) => ({
  project_key: projectKey, title: 'Login button does nothing', description: 'Tapping login on the home page does nothing.',
  steps_to_reproduce: null, module: null, page: null, category: 'Bug', priority: 'High', severity: 'Major', environment: null,
});

async function clientOnProject() {
  const admin = await user(ROLE_IDS.ADMIN);
  const company = await Client.create({ name: 'Company A', createdBy: admin._id });
  const project = await Project.create({ key: 'A1', name: 'A One', client: company._id, createdBy: admin._id });
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const access = await AccessAssignment.create({
    user: tester._id, role: ROLE_IDS.CLIENT_TESTER, client: company._id, project: project._id, grantedBy: admin._id,
  });
  await linked(tester);
  return { tester, access };
}

test('a drafted ticket is filed once on "yes", as the linked user, without asking the model', async (t) => {
  const { tester } = await clientOnProject();
  const calls = draftingModel(t, ticketDraft('A1'));

  await answer(config, sender, text('file a bug: login button does nothing'));
  assert.equal(await Ticket.countDocuments(), 0, 'nothing is filed before yes');

  const modelCalls = calls.count;
  assert.match(await answer(config, sender, text('Yes')), /^Created \*A1-1\*: Login button does nothing$/);
  assert.equal(calls.count, modelCalls, 'yes is handled without the model');
  const ticket = await Ticket.findOne().lean();
  assert.equal(String(ticket.createdBy), String(tester._id));
  assert.equal(ticket.activityLog[0].via, 'whatsapp');
  const [audit] = await RbacAuditLog.find({ action: /^whatsapp\.ticket_/ }).lean();
  assert.equal(audit.action, 'whatsapp.ticket_created');
  assert.equal(audit.category, 'whatsapp');
  assert.equal(String(audit.actor), String(tester._id));
  assert.equal(audit.details.waId, sender.waId);
  assert.equal(audit.details.ticketId, 'A1-1');
  assert.match(audit.details.messageId, /^wamid\./);

  // The draft is used up: another yes goes to the model and files nothing.
  await answer(config, sender, text('yes'));
  assert.equal(await Ticket.countDocuments(), 1);
  // And the model is told how the draft ended, not left with the "waiting" note from when it drafted.
  const state = await WhatsappState.findOne({ messages: { $exists: true } }).lean();
  const created = state.messages.find((message) => message.content.startsWith('Created *A1-1*'));
  assert.match(created.content, /\n\n\[Draft "New ticket"\. Status: confirmed and applied, created A1-1\]$/);
});

test('"no" drops the draft and files nothing', async (t) => {
  await clientOnProject();
  draftingModel(t, ticketDraft('A1'));
  await answer(config, sender, text('file a bug: login button does nothing'));
  assert.equal(await answer(config, sender, text('no')), 'Cancelled. Nothing was created.');
  assert.equal((await RbacAuditLog.findOne({ action: /^whatsapp\.ticket_/ }).lean()).action, 'whatsapp.ticket_cancelled');
  const state = await WhatsappState.findOne({ messages: { $exists: true } }).lean();
  assert.match(state.messages.at(-1).content, /Status: cancelled by the user, nothing was created\]$/);
  await answer(config, sender, text('yes'));
  assert.equal(await Ticket.countDocuments(), 0);
});

test('a draft still waiting is asked about again after an unrelated answer, so "ok" answers what was shown', async (t) => {
  await clientOnProject();
  draftingModel(t, ticketDraft('A1'), 'A1-7 is in QA. Want its comments?');
  await answer(config, sender, text('file a bug: login button does nothing'));
  assert.equal(
    await answer(config, sender, text('status of A1-7?')),
    'A1-7 is in QA. Want its comments?\n\nCreate the ticket "Login button does nothing"? Reply *yes* to create it, or *no* to cancel.',
  );
});

test('bubbles sent in a row are answered one at a time, each seeing the one before', async (t) => {
  await adminWithTicket();
  const inputs = [];
  mockFetch(t, async (_url, init) => {
    inputs.push(JSON.parse(init.body).input.map((item) => item.content).filter(Boolean));
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    return json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }] });
  });
  const replies = await Promise.all([
    answer(config, sender, text('login page is broken')),
    answer(config, sender, text('on android')),
  ]);
  assert.deepEqual(replies, ['Noted.', 'Noted.']);
  const [first, second] = inputs;
  assert.ok(second.includes(first.at(-1)), 'the second turn sees the first bubble');
  const state = await WhatsappState.findOne({ messages: { $exists: true } }).lean();
  assert.equal(state.messages.length, 4, 'neither exchange overwrote the other');
});

test('access removed after the draft means "yes" files nothing', async (t) => {
  const { access } = await clientOnProject();
  draftingModel(t, ticketDraft('A1'));
  await answer(config, sender, text('file a bug: login button does nothing'));
  await AccessAssignment.deleteOne({ _id: access._id });
  assert.match(await answer(config, sender, text('yes')), /^I couldn't create it/);
  assert.equal((await RbacAuditLog.findOne({ action: /^whatsapp\.ticket_/ }).lean()).action, 'whatsapp.ticket_failed');
  assert.equal(await Ticket.countDocuments(), 0);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/**
 * Meta's media endpoints, the model and the transcriber behind one fake fetch.
 * `media` maps a media id to { mime, bytes, size? }; `replies` are model turns in order.
 */
function fakeNetwork(t, { media = {}, replies = [], say = 'OK.', heard = '' } = {}) {
  const seen = { model: [], downloads: 0, transcribed: 0 };
  seen.typed = mockFetch(t, async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://graph.facebook.com/')) {
      const id = decodeURIComponent(href.split('/').pop());
      const file = media[id];
      if (!file) return json({}, 404);
      return json({ url: `https://lookaside.test/${id}`, mime_type: file.mime, file_size: file.size ?? file.bytes.length });
    }
    if (href.startsWith('https://lookaside.test/')) {
      seen.downloads += 1;
      return new Response(media[href.split('/').pop()].bytes, { status: 200 });
    }
    if (href.endsWith('/audio/transcriptions')) {
      seen.transcribed += 1;
      return json({ text: heard });
    }
    seen.model.push(JSON.parse(init.body));
    return json(replies.shift() ?? { output: [{ type: 'message', content: [{ type: 'output_text', text: say }] }] });
  });
  return seen;
}

/** Stands in for S3, recording what would have been stored. */
const fakeStorage = () => {
  const puts = [];
  return { puts, putObject: async ({ key }) => { puts.push(key); }, deleteObject: async () => {} };
};

const image = (mediaId, caption) => ({
  id: `wamid.${seq += 1}`, type: 'image', timestamp: '1790000000', image: { id: mediaId, mime_type: 'image/png', ...(caption ? { caption } : {}) },
});
const documentMessage = (mediaId, filename) => ({
  id: `wamid.${seq += 1}`, type: 'document', document: { id: mediaId, filename, mime_type: 'application/octet-stream' },
});
const voice = (mediaId) => ({ id: `wamid.${seq += 1}`, type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true } });
const toolCall = (name, args) => ({ output: [{ type: 'function_call', name, call_id: 'c1', arguments: JSON.stringify(args) }] });

async function adminWithTicket() {
  const admin = await user(ROLE_IDS.ADMIN);
  const company = await Client.create({ name: 'Company A', createdBy: admin._id });
  const project = await Project.create({ key: 'A1', name: 'A One', client: company._id, createdBy: admin._id });
  await Ticket.create({
    ticketId: 'A1-1', project: project._id, title: 'Login page is broken', createdBy: admin._id,
    severity: 'Major', priority: 'High', status: 'pending',
  });
  await linked(admin);
  return admin;
}

test('a screenshot with a caption becomes a draft, and "yes" files the ticket with it attached', async (t) => {
  const { tester } = await clientOnProject();
  const storage = fakeStorage();
  const net = fakeNetwork(t, {
    media: { 'm-1': { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_create_ticket', ticketDraft('A1'))],
    say: 'Reply *yes* to create it, *no* to cancel.',
  });

  const prompt = await answer(config, sender, image('m-1', 'login is broken'), { storage });
  // The model's own "no to cancel" line gives way to the question that names the file.
  assert.match(prompt, /^Create the ticket "Login button does nothing" with \*whatsapp-photo-.+\.png\* attached\? Reply \*yes\* to create it with the file, \*no\* to skip the file, or \*cancel\*\. Or tell me what to change\.$/);
  assert.equal(await Ticket.countDocuments(), 0, 'nothing is filed before yes');
  assert.equal(storage.puts.length, 0, 'nothing is stored before yes');
  const lastInput = net.model[0].input.at(-1).content;
  assert.match(lastInput, /^login is broken\n\[Files ready to attach: whatsapp-photo-\d{8}-\d{6}\.png\]$/);

  const reply = await answer(config, sender, text('yes'), { storage });
  assert.match(reply, /^Created \*A1-1\*: Login button does nothing, with \*whatsapp-photo-.+\.png\* attached\.$/);
  const ticket = await Ticket.findOne().lean();
  assert.equal(ticket.attachments.length, 1);
  assert.equal(String(ticket.attachments[0].uploadedBy), String(tester._id));
  assert.equal(ticket.activityLog.at(-1).via, 'whatsapp');
  assert.equal(storage.puts.length, 1);
  const audit = await RbacAuditLog.findOne({ action: 'whatsapp.ticket_created' }).lean();
  assert.equal(audit.details.files.length, 1);
  assert.equal(await WhatsappState.countDocuments({ 'files.0': { $exists: true } }), 0, 'the files are used up');
});

test('a file for an existing ticket is attached only after "yes", once', async (t) => {
  await adminWithTicket();
  const storage = fakeStorage();
  fakeNetwork(t, {
    media: { 'm-2': { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
  });

  const prompt = await answer(config, sender, image('m-2', 'add this to A1-1'), { storage });
  assert.match(prompt, /^Attach \*whatsapp-photo-.+\.png\* to \*A1-1\*: Login page is broken\? Reply \*yes\* to attach, \*no\* to skip the file, or \*cancel\*\.$/);
  assert.equal(storage.puts.length, 0);

  const yes = text('yes');
  assert.match(await answer(config, sender, yes, { storage }), /^Added \*whatsapp-photo-.+\.png\* to \*A1-1\*\.$/);
  // Meta redelivering the same yes does nothing.
  assert.equal(await answer(config, sender, yes, { storage }), null);
  // A second yes has no draft left to confirm.
  await answer(config, sender, text('yes'), { storage });

  const ticket = await Ticket.findOne({ ticketId: 'A1-1' }).lean();
  assert.equal(ticket.attachments.length, 1);
  assert.equal(storage.puts.length, 1);
  const audit = await RbacAuditLog.findOne({ action: 'whatsapp.attach_added' }).lean();
  assert.equal(audit.details.ticketId, 'A1-1');
  assert.equal(audit.details.waId, sender.waId);
  assert.equal(audit.details.files.length, 1);
});

test('"no" to attaching skips the file but keeps the ticket waiting; "cancel" then drops it', async (t) => {
  await adminWithTicket();
  const storage = fakeStorage();
  const net = fakeNetwork(t, {
    media: { 'm-3': { mime: 'image/png', bytes: PNG }, 'm-3b': { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
  });
  await answer(config, sender, image('m-3', 'add this to A1-1'), { storage });
  const downloads = net.downloads;
  assert.match(
    await answer(config, sender, text('no'), { storage }),
    /^Skipped \*whatsapp-photo-.+\.png\*\. Nothing was attached\.\n\nSend the file here and I'll ask before adding it to \*A1-1\*: Login page is broken\. Reply \*cancel\* to stop\.$/,
  );
  assert.equal(net.downloads, downloads, 'a skipped file is not fetched again');
  const skipped = await RbacAuditLog.findOne({ action: 'whatsapp.attach_skipped' }).lean();
  assert.equal(skipped.details.ticketId, 'A1-1');
  assert.equal(skipped.details.files.length, 1);

  // Still waiting on A1-1: the next file is asked about, not attached.
  assert.match(await answer(config, sender, image('m-3b'), { storage }), /^Got \*.+\*\. Attach \*.+\* to \*A1-1\*: Login page is broken\? Reply \*yes\* to attach/);
  assert.equal(await answer(config, sender, text('cancel'), { storage }), 'Cancelled. Nothing was attached.');
  assert.ok(await RbacAuditLog.exists({ action: 'whatsapp.attach_cancelled' }));
  assert.equal(await WhatsappState.countDocuments({ $or: [{ attach: { $exists: true } }, { 'files.0': { $exists: true } }] }), 0);

  assert.equal(storage.puts.length, 0);
  assert.equal((await Ticket.findOne({ ticketId: 'A1-1' }).lean()).attachments.length, 0);
});

test('"no" on a new ticket with files drops the files and asks again; "cancel" files nothing', async (t) => {
  await clientOnProject();
  const storage = fakeStorage();
  fakeNetwork(t, {
    media: { 'm-5': { mime: 'image/png', bytes: PNG }, 'm-6': { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_create_ticket', ticketDraft('A1')), { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Drafted.' }] }] },
      toolCall('propose_create_ticket', ticketDraft('A1'))],
    say: 'Drafted.',
  });

  await answer(config, sender, image('m-5', 'login is broken'), { storage });
  assert.match(
    await answer(config, sender, text('no'), { storage }),
    /^Skipped \*.+\.png\*\. Nothing was attached\.\n\nCreate the ticket "Login button does nothing"\? Reply \*yes\* to create it, or \*no\* to cancel\.$/,
  );
  assert.match(await answer(config, sender, text('yes'), { storage }), /^Created \*A1-1\*: Login button does nothing$/);
  assert.equal((await Ticket.findOne().lean()).attachments.length, 0);

  await answer(config, sender, image('m-6', 'another bug'), { storage });
  assert.equal(await answer(config, sender, text('cancel'), { storage }), 'Cancelled. Nothing was created.');
  assert.equal(await Ticket.countDocuments(), 1);
  assert.equal(storage.puts.length, 0);
});

test('photos sent together: a yes attaches only the ones its question named, then the rest are asked about', async (t) => {
  await adminWithTicket();
  const storage = fakeStorage();
  const late = [];
  const net = fakeNetwork(t, {
    media: {
      p1: { mime: 'image/png', bytes: PNG },
      p2: { mime: 'image/png', bytes: PNG },
      p3: { mime: 'image/png', bytes: PNG },
    },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
  });
  // p2 and p3 land while the model is still drafting for p1's caption, as parallel webhooks do.
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (!String(url).startsWith('https://graph.facebook.com/') && !String(url).startsWith('https://lookaside.test/') && !late.length) {
      late.push(await answer(config, sender, documentMessage('p2', 'two.png'), { storage }));
      late.push(await answer(config, sender, documentMessage('p3', 'three.png'), { storage }));
    }
    return original(url, init);
  });

  const first = await answer(config, sender, { ...documentMessage('p1', 'one.png'), document: { id: 'p1', filename: 'one.png', caption: 'add these to A1-1' } }, { storage });
  assert.equal(first, 'Attach *one.png* to *A1-1*: Login page is broken? Reply *yes* to attach, *no* to skip the file, or *cancel*.');
  assert.match(late[0], /^Got \*two\.png\*\. What is it for\?/);

  const next = await answer(config, sender, text('yes'), { storage });
  assert.equal(next, 'Added *one.png* to *A1-1*.\n\n'
    + 'Attach *two.png*, *three.png* to *A1-1*: Login page is broken? Reply *yes* to attach, *no* to skip the files, or *cancel*.');
  let ticket = await Ticket.findOne({ ticketId: 'A1-1' }).lean();
  assert.equal(ticket.attachments.length, 1);
  assert.equal(storage.puts.length, 1, 'only the named file is stored');

  assert.equal(await answer(config, sender, text('yes'), { storage }), 'Added *two.png*, *three.png* to *A1-1*.');
  ticket = await Ticket.findOne({ ticketId: 'A1-1' }).lean();
  assert.equal(ticket.attachments.length, 3);
  assert.equal(storage.puts.length, 3);
  assert.ok(net.downloads >= 6, 'each file is fetched once to check it and once more at yes');
});

test('a file that arrives while a question is waiting is added to the question before any yes', async (t) => {
  await adminWithTicket();
  const storage = fakeStorage();
  fakeNetwork(t, {
    media: { q1: { mime: 'image/png', bytes: PNG }, q2: { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
  });
  await answer(config, sender, { ...documentMessage('q1', 'one.png'), document: { id: 'q1', filename: 'one.png', caption: 'for A1-1' } }, { storage });
  assert.equal(
    await answer(config, sender, documentMessage('q2', 'two.png'), { storage }),
    'Got *two.png*. Attach *one.png*, *two.png* to *A1-1*: Login page is broken? Reply *yes* to attach, *no* to skip the files, or *cancel*.',
  );
  assert.equal(await answer(config, sender, text('yes'), { storage }), 'Added *one.png*, *two.png* to *A1-1*.');
  assert.equal(storage.puts.length, 2);
});

test('a model answer while files wait ends with the file question, so a yes answers that one', async (t) => {
  await adminWithTicket();
  const storage = fakeStorage();
  fakeNetwork(t, {
    media: { w1: { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
    say: 'A1-1 is pending. Want me to list its comments?',
  });
  await answer(config, sender, { ...documentMessage('w1', 'one.png'), document: { id: 'w1', filename: 'one.png', caption: 'for A1-1' } }, { storage });
  assert.equal(
    await answer(config, sender, text('what is its status?'), { storage }),
    'A1-1 is pending. Want me to list its comments?\n\n'
      + 'Attach *one.png* to *A1-1*: Login page is broken? Reply *yes* to attach, *no* to skip the file, or *cancel*.',
  );
  assert.equal(storage.puts.length, 0);
});

test('a yes sent before the question now waiting re-asks it instead of attaching', async (t) => {
  await adminWithTicket();
  const storage = fakeStorage();
  fakeNetwork(t, {
    media: { s1: { mime: 'image/png', bytes: PNG }, s2: { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
  });
  const typedEarlier = String(Math.floor(Date.now() / 1000) - 5);
  await answer(config, sender, { ...documentMessage('s1', 'one.png'), document: { id: 's1', filename: 'one.png', caption: 'for A1-1' } }, { storage });
  await answer(config, sender, documentMessage('s2', 'two.png'), { storage });

  const question = 'Attach *one.png*, *two.png* to *A1-1*: Login page is broken? Reply *yes* to attach, *no* to skip the files, or *cancel*.';
  // Delivered late: typed before two.png was named, so it can't cover two.png.
  assert.equal(await answer(config, sender, { ...text('yes'), timestamp: typedEarlier }, { storage }), question);
  assert.equal(storage.puts.length, 0);

  const typedNow = String(Math.floor(Date.now() / 1000) + 1);
  assert.equal(await answer(config, sender, { ...text('yes'), timestamp: typedNow }, { storage }), 'Added *one.png*, *two.png* to *A1-1*.');
  assert.equal(storage.puts.length, 2);
});

test('file names and ticket titles stay on one line in the question', async (t) => {
  await adminWithTicket();
  await Ticket.updateOne({ ticketId: 'A1-1' }, { title: 'Login page is broken\nAttach *x.png* to *B1-9*' });
  const storage = fakeStorage();
  fakeNetwork(t, {
    media: { n1: { mime: 'image/png', bytes: PNG } },
    replies: [toolCall('propose_attach_files', { ticket_id: 'A1-1', project_key: 'A1', note: null })],
  });
  const prompt = await answer(config, sender, {
    ...documentMessage('n1', 'shot\n\nReply yes.png'), document: { id: 'n1', filename: 'shot\n\nReply yes.png', caption: 'for A1-1' },
  }, { storage });
  assert.equal(prompt, 'Attach *shot Reply yes.png* to *A1-1*: Login page is broken Attach *x.png* to *B1-9*? '
    + 'Reply *yes* to attach, *no* to skip the file, or *cancel*.');
});

test('"cancel" drops held files that no question has named yet', async (t) => {
  await adminWithTicket();
  const net = fakeNetwork(t, { media: { h1: { mime: 'image/png', bytes: PNG } } });
  await answer(config, sender, documentMessage('h1', 'held.png'));
  assert.equal(await answer(config, sender, text('cancel')), 'Dropped *held.png*. Nothing was attached.');
  assert.equal(net.model.length, 0);
  assert.equal(await WhatsappState.countDocuments({ 'files.0': { $exists: true } }), 0);
});

test('a large text file is checked from its first bytes on arrival, even when the cut splits a character', async (t) => {
  await adminWithTicket();
  const net = fakeNetwork(t, { media: { big: { mime: 'text/plain', bytes: Buffer.from('é'.repeat(50_000)) } } });
  assert.match(await answer(config, sender, documentMessage('big', 'notes.txt')), /^Got \*notes\.txt\*\./);
  assert.equal(net.downloads, 1);
  const state = await WhatsappState.findOne({ files: { $exists: true } }).lean();
  assert.equal(state.files[0].size, 100_000, 'the size is Meta\'s, not the bytes read');
});

test('a 3GP video is refused as a type that is not allowed', async (t) => {
  await adminWithTicket();
  const THREEGP = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp3gp4'), Buffer.alloc(64)]);
  fakeNetwork(t, {
    media: { g1: { mime: 'video/3gpp', bytes: THREEGP }, g2: { mime: 'video/3gpp', bytes: THREEGP } },
  });
  const video = { id: `wamid.${seq += 1}`, type: 'video', timestamp: '1790000000', video: { id: 'g1', mime_type: 'video/3gpp' } };
  assert.equal(await answer(config, sender, video), 'I can\'t attach that file. Files of type video/3gpp are not allowed.');
  assert.equal(await answer(config, sender, documentMessage('g2', 'clip.3gp')), 'I can\'t attach that file. ".3gp" files are not allowed.');
  assert.equal(await WhatsappState.countDocuments({ 'files.0': { $exists: true } }), 0);
});

test('a file with no caption is held and asked about, without calling the model', async (t) => {
  await adminWithTicket();
  const net = fakeNetwork(t, { media: { 'm-4': { mime: 'image/png', bytes: PNG } } });
  assert.match(await answer(config, sender, image('m-4')), /^Got \*whatsapp-photo-.+\.png\*\. What is it for\?/);
  assert.equal(net.model.length, 0);
  assert.equal(net.typed.length, 1);
  const state = await WhatsappState.findOne({ files: { $exists: true } }).lean();
  assert.deepEqual(state.files.map((file) => file.mediaId), ['m-4']);
});

test('files over 25 MB or of a blocked type are refused before anything is held', async (t) => {
  await adminWithTicket();
  const net = fakeNetwork(t, {
    media: {
      big: { mime: 'video/mp4', bytes: PNG, size: 26 * 1024 * 1024 },
      exe: { mime: 'application/octet-stream', bytes: PNG },
    },
  });
  assert.match(await answer(config, sender, documentMessage('big', 'clip.mp4')), /^I can't attach that file\. It is over 25 MB/);
  assert.equal(net.downloads, 0, 'too big is known from the size, without downloading');
  assert.match(await answer(config, sender, documentMessage('exe', 'run.exe')), /^I can't attach that file\. "\.exe" files are not accepted/);
  assert.equal(await WhatsappState.countDocuments({ files: { $exists: true } }), 0);
});

test('a voice note is transcribed and answered as if typed', async (t) => {
  await adminWithTicket();
  const net = fakeNetwork(t, {
    media: { 'v-1': { mime: 'audio/ogg; codecs=opus', bytes: OGG } },
    heard: 'what is the status of A1-1',
    say: 'A1-1 is pending.',
  });
  assert.equal(await answer(config, sender, voice('v-1')), 'A1-1 is pending.');
  assert.equal(net.transcribed, 1);
  assert.equal(net.model[0].input.at(-1).content, 'what is the status of A1-1');
  const state = await WhatsappState.findOne({ messages: { $exists: true } }).lean();
  assert.equal(state.messages[0].content, 'what is the status of A1-1');
  assert.equal(state.files, undefined, 'the audio is not kept');
});

test('a silent voice note says so, without calling the model', async (t) => {
  await adminWithTicket();
  const net = fakeNetwork(t, { media: { 'v-2': { mime: 'audio/ogg', bytes: OGG } }, heard: '' });
  assert.equal(await answer(config, sender, voice('v-2')), REPLIES.unheard);
  assert.equal(net.model.length, 0);
});

test('markdown from the model is turned into WhatsApp formatting', () => {
  assert.equal(
    toWhatsapp('## Projects' + String.fromCharCode(10) + '* **Web App** (WEB)' + String.fromCharCode(10) + 'See [WEB-1](https://x.test/t/WEB-1)'),
    '*Projects*' + String.fromCharCode(10) + '- *Web App* (WEB)' + String.fromCharCode(10) + 'See WEB-1: https://x.test/t/WEB-1',
  );
});
