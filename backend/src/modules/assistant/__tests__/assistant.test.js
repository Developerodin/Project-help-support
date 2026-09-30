import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Client from '../../clients/client.model.js';
import { createTicket } from '../../tickets/ticket.service.js';
import { runTool, toolsFor } from '../assistant.tools.js';
import { chat } from '../assistant.service.js';
import { isAudio } from '../assistant.route.js';

withMemoryDb();

const user = (over = {}) => User.create({
  name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active',
  role: ROLE_IDS.DEVELOPER, roles: [ROLE_IDS.DEVELOPER], ...over,
});

const project = () => Project.create({
  key: 'WEB', name: 'Web App', createdBy: new mongoose.Types.ObjectId(),
  modules: [{ label: 'Chats', pages: [{ label: 'Inbox' }] }],
});

const ctxFor = (actor) => ({ user: actor, permissionContext: null, actions: [], projects: null });
const config = { assistant: { apiKey: 'sk-test', chatModel: 'test-model' } };

test('reads go through ticket visibility: the reporter finds it, a stranger cannot', async () => {
  const reporter = await user();
  const stranger = await user();
  const web = await project();
  const ticket = await createTicket(reporter, { project: web.id, title: 'Chat inbox is empty' });

  const found = await runTool('search_tickets', JSON.stringify({ query: 'inbox' }), ctxFor(reporter));
  assert.deepEqual(found.tickets.map((t) => t.id), [ticket.ticketId]);

  const hidden = await runTool('get_ticket', JSON.stringify({ ticket_id: ticket.ticketId }), ctxFor(stranger));
  assert.match(hidden.error, /not found|access/i);
});

test('propose_create_ticket drafts an action and writes nothing', async () => {
  const actor = await user();
  await project();
  const ctx = ctxFor(actor);

  const result = await runTool('propose_create_ticket', JSON.stringify({
    project_key: 'web', title: 'Inbox never loads', description: 'Opening the inbox spins forever.',
    steps_to_reproduce: null, module: 'Chats', page: 'Inbox', category: 'Bug', priority: 'High', severity: 'Major',
    environment: null,
  }), ctx);

  assert.equal(result.status, 'proposed');
  assert.equal(ctx.actions.length, 1);
  assert.equal(ctx.actions[0].type, 'create_ticket');
  assert.equal(ctx.actions[0].body.module, 'Chats');
  assert.equal(ctx.actions[0].body.priority, 'High');
  assert.equal(ctx.actions[0].body.environment, 'Staging');
  assert.deepEqual(ctx.actions[0].modules, [{ label: 'Chats', pages: ['Inbox'] }]);
  assert.equal(await Ticket.countDocuments({}), 0);
});

test('propose_create_ticket refuses a draft that skips where or how bad, listing the choices', async () => {
  const actor = await user();
  await project();
  const ctx = ctxFor(actor);

  const result = await runTool('propose_create_ticket', JSON.stringify({
    project_key: 'WEB', title: 'Inbox never loads', description: 'Opening the inbox spins forever.',
    steps_to_reproduce: null, module: 'Chats', page: null, category: null, priority: 'High', severity: null,
    environment: null,
  }), ctx);

  assert.match(result.error, /page in Chats \(one of: Inbox\)/);
  assert.match(result.error, /category \(Bug, New Feature, Improvement\)/);
  assert.match(result.error, /severity/);
  assert.doesNotMatch(result.error, /priority/);
  assert.equal(ctx.actions.length, 0);
});

test('propose_create_ticket rejects a module the project does not have', async () => {
  const actor = await user();
  await project();
  const ctx = ctxFor(actor);

  const result = await runTool('propose_create_ticket', JSON.stringify({
    project_key: 'WEB', title: 'Something broke', description: 'Something broke badly here.',
    steps_to_reproduce: null, module: 'Billing', page: null, category: 'Bug', priority: 'Low', severity: 'Minor',
    environment: null,
  }), ctx);

  assert.match(result.error, /Billing/);
  assert.equal(ctx.actions.length, 0);
});

test('chat runs tool calls and returns the final reply with drafted actions', async (t) => {
  const actor = await user();
  const web = await project();
  const ticket = await createTicket(actor, { project: web.id, title: 'Chat inbox is empty' });

  const bodies = [];
  const replies = [
    { output: [{ type: 'function_call', name: 'search_tickets', call_id: 'c1', arguments: JSON.stringify({ query: 'inbox' }) }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: `Found ${ticket.ticketId}.` }] }] },
  ];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  });

  const out = await chat(config, actor, null, [{ role: 'user', content: 'Any inbox tickets?' }]);

  assert.equal(out.reply, `Found ${ticket.ticketId}.`);
  assert.deepEqual(out.actions, []);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].store, false);
  const toolOutput = bodies[1].input.find((item) => item.type === 'function_call_output');
  assert.equal(toolOutput.call_id, 'c1');
  assert.equal(JSON.parse(toolOutput.output).tickets[0].id, ticket.ticketId);
});

test('chat maps an upstream failure to a stable error and says it is disabled without a key', async (t) => {
  const actor = await user();
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.rejects(
    chat(config, actor, null, [{ role: 'user', content: 'hi' }]),
    (err) => err.statusCode === 502 && err.code === 'ASSISTANT_UPSTREAM',
  );
  await assert.rejects(
    chat({ assistant: null }, actor, null, [{ role: 'user', content: 'hi' }]),
    (err) => err.statusCode === 503 && err.code === 'ASSISTANT_DISABLED',
  );
});

test('isAudio accepts recorded formats by magic bytes and rejects everything else', () => {
  const pad = (head) => Buffer.concat([head, Buffer.alloc(16)]);
  assert.equal(isAudio(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))), true);
  assert.equal(isAudio(pad(Buffer.from('OggS'))), true);
  assert.equal(isAudio(pad(Buffer.from('RIFF....WAVE', 'latin1'))), true);
  assert.equal(isAudio(pad(Buffer.from('....ftypM4A ', 'latin1'))), true);
  assert.equal(isAudio(pad(Buffer.from('%PDF-1.7'))), false);
  assert.equal(isAudio(Buffer.from('tiny')), false);
});

const navArgs = (over) => JSON.stringify({ destination: 'tickets', ticket_id: null, ticket_tab: null, ...over });

test('navigate builds app hrefs from fixed values', async () => {
  const actor = await user();
  const ctx = ctxFor(actor);

  await runTool('navigate', navArgs({}), ctx);
  const board = ctxFor(actor);
  await runTool('navigate', navArgs({ destination: 'board' }), board);

  assert.deepEqual([...ctx.actions, ...board.actions].map((a) => [a.type, a.href]), [
    ['navigate', '/tickets'],
    ['navigate', '/tickets/board'],
  ]);
  const bad = await runTool('navigate', navArgs({ destination: 'https://evil.example' }), ctxFor(actor));
  assert.match(bad.error, /Unknown destination/);
});

test('navigate opens a ticket only when the user can see it', async () => {
  const reporter = await user();
  const stranger = await user();
  const web = await project();
  const ticket = await createTicket(reporter, { project: web.id, title: 'Chat inbox is empty' });

  const ok = ctxFor(reporter);
  await runTool('navigate', navArgs({ destination: 'ticket', ticket_id: ticket.ticketId.toLowerCase() }), ok);
  assert.equal(ok.actions[0].href, `/tickets?ticket=${ticket.ticketId}`);

  const denied = ctxFor(stranger);
  const result = await runTool('navigate', navArgs({ destination: 'ticket', ticket_id: ticket.ticketId }), denied);
  assert.match(result.error, /not found|access/i);
  assert.equal(denied.actions.length, 0);
});

test('get_ticket reads the full picture: progress, history, files and comments', async () => {
  const actor = await user();
  const web = await project();
  const created = await createTicket(actor, {
    project: web.id, title: 'Chat inbox is empty', description: 'The inbox shows nothing after login.',
  });
  await Ticket.updateOne({ ticketId: created.ticketId }, {
    $push: {
      attachments: { key: 'k1', name: 'screen.png', size: 20480, mimeType: 'image/png', uploadedBy: actor._id },
      comments: { content: 'Seen on Chrome too.', commentedBy: actor._id },
    },
  });

  const out = await runTool('get_ticket', JSON.stringify({ ticket_id: created.ticketId }), ctxFor(actor));

  assert.equal(out.stage_step, '1 of 10');
  assert.equal(out.next_stage, 'Under Review');
  assert.equal(out.description, 'The inbox shows nothing after login.');
  assert.deepEqual(out.attachments.map((file) => [file.name, file.type, file.size_kb]), [['screen.png', 'image/png', 20]]);
  assert.equal(out.comment_count, 1);

  const discussion = await runTool('get_ticket_discussion', JSON.stringify({ ticket_id: created.ticketId }), ctxFor(actor));
  assert.equal(discussion.comments[0].text, 'Seen on Chrome too.');

  const ctx = ctxFor(actor);
  await runTool('open_attachment', JSON.stringify({ ticket_id: created.ticketId, attachment_id: out.attachments[0].id }), ctx);
  assert.deepEqual(ctx.actions.map((a) => [a.type, a.name]), [['attachment', 'screen.png']]);
  const missing = await runTool('open_attachment', JSON.stringify({ ticket_id: created.ticketId, attachment_id: 'nope' }), ctxFor(actor));
  assert.match(missing.error, /No such file/);
});

test('admin tools are offered only to people the matching REST routes allow', async () => {
  const names = (tools) => tools.map((tool) => tool.name);
  const dev = names(toolsFor(await user(), null));
  const admin = names(toolsFor(await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] }), null));

  for (const tool of ['search_users', 'propose_create_project', 'propose_create_team', 'propose_client_brand']) {
    assert.equal(dev.includes(tool), false, `developer should not get ${tool}`);
    assert.equal(admin.includes(tool), true, `admin should get ${tool}`);
  }
  assert.ok(dev.includes('get_ticket_discussion'));
  assert.ok(dev.includes('open_attachment'));
  // Naming a tool that was not offered is refused, whatever the model says.
  const refused = await runTool('propose_client_brand', JSON.stringify({ client_name: null, new_name: 'Evil' }), ctxFor(await user()));
  assert.match(refused.error, /not available/);
});

test('admin drafts: a project for a client, a team by email, and a client brand', async () => {
  const admin = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const lead = await user({ name: 'Lin', email: 'lin@example.com' });
  const acme = await Client.create({ name: 'Acme', createdBy: admin._id });
  await project();
  const ctx = { ...ctxFor(admin), config: { storage: null } };

  await runTool('propose_create_project', JSON.stringify({
    client_name: 'acme', name: 'Acme Portal', key: 'acp', description: null,
    modules: [{ label: 'Billing', pages: ['Invoices', 'Invoices', ' '] }],
  }), ctx);
  await runTool('propose_create_team', JSON.stringify({
    name: 'Portal squad', project_key: 'WEB', lead_email: 'LIN@example.com', member_emails: ['lin@example.com'],
  }), ctx);
  await runTool('propose_client_brand', JSON.stringify({ client_name: 'Acme', new_name: 'Acme Corp' }), ctx);

  const [projectDraft, teamDraft, brandDraft] = ctx.actions;
  assert.deepEqual(projectDraft.body, {
    clientId: String(acme._id), name: 'Acme Portal', key: 'ACP', modules: [{ label: 'Billing', pages: [{ label: 'Invoices' }] }],
  });
  assert.equal(teamDraft.body.lead, String(lead._id));
  assert.deepEqual(teamDraft.body.members, [String(lead._id)]);
  assert.equal(teamDraft.projectKey, 'WEB');
  assert.deepEqual([brandDraft.clientId, brandDraft.currentName, brandDraft.name], [String(acme._id), 'Acme', 'Acme Corp']);

  const unknown = await runTool('propose_create_team', JSON.stringify({
    name: 'X team', project_key: null, lead_email: 'ghost@example.com', member_emails: [],
  }), ctx);
  assert.match(unknown.error, /No user with email/);
});

test('transcription hints English/Hindi/Hinglish and redoes an Arabic-script result as Hindi', async (t) => {
  const { transcribe } = await import('../openai.client.js');
  const sent = [];
  const results = ['کیا یہ ٹکٹ بند ہے', 'क्या यह टिकट बंद है'];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push({ prompt: init.body.get('prompt'), language: init.body.get('language') });
    return new Response(JSON.stringify({ text: results.shift() }), { status: 200 });
  });
  const audio = { buffer: Buffer.from('x'), mimetype: 'audio/webm', originalname: 'v.webm' };

  const { text, attempts } = await transcribe({ assistant: { apiKey: 'k', transcribeModel: 'm' } }, audio);

  assert.equal(text, 'क्या यह टिकट बंद है');
  assert.equal(attempts, 2, 'both calls are billed, so both count against the cap');
  assert.equal(sent.length, 2);
  assert.match(sent[0].prompt, /English, Hindi/);
  assert.equal(sent[0].language, null);
  assert.equal(sent[1].language, 'hi');
});

test('transcription keeps an English or Hinglish result as is, in one call', async (t) => {
  const { transcribe } = await import('../openai.client.js');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response(JSON.stringify({ text: 'mera ticket WEB-55 kab close hoga' }), { status: 200 });
  });
  const { text, attempts } = await transcribe(
    { assistant: { apiKey: 'k', transcribeModel: 'm' } },
    { buffer: Buffer.from('x'), mimetype: 'audio/webm' },
  );
  assert.equal(text, 'mera ticket WEB-55 kab close hoga');
  assert.equal(attempts, 1);
  assert.equal(calls, 1);
});

test('voice mode tells the model the user only sees a small preview, not "the card below"', async (t) => {
  const actor = await user();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body).instructions);
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
  });
  await chat(config, actor, null, [{ role: 'user', content: 'hi' }], { mode: 'voice' });
  await chat(config, actor, null, [{ role: 'user', content: 'hi' }]);
  assert.match(sent[0], /Voice mode:.*say "confirm" or "cancel"/s);
  assert.doesNotMatch(sent[1], /Voice mode:/);
});

test('voice mode asks for a quick answer; typed chat keeps the model default', async (t) => {
  const actor = await user();
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
  });
  await chat(config, actor, null, [{ role: 'user', content: 'hi' }], { mode: 'voice' });
  await chat(config, actor, null, [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(bodies[0].reasoning, { effort: 'low' });
  assert.deepEqual(bodies[0].text, { verbosity: 'low' });
  assert.equal('reasoning' in bodies[1], false);
});

test('a cancelled chat stops calling the model and says so', async (t) => {
  const actor = await user();
  const cancelled = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls += 1;
    cancelled.abort(); // the user interrupts while the model is working
    if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response('{}', { status: 200 });
  });
  await assert.rejects(
    chat(config, actor, null, [{ role: 'user', content: 'hi' }], { signal: cancelled.signal }),
    (err) => err.code === 'ASSISTANT_CANCELLED',
  );
  assert.equal(calls, 1);
});

test('navigate can open a ticket on a given tab', async () => {
  const reporter = await user();
  const web = await project();
  const ticket = await createTicket(reporter, { project: web.id, title: 'Chat inbox is empty' });
  const ctx = ctxFor(reporter);
  await runTool('navigate', navArgs({ destination: 'ticket', ticket_id: ticket.ticketId, ticket_tab: 'history' }), ctx);
  assert.equal(ctx.actions[0].href, `/tickets?ticket=${ticket.ticketId}&tab=history`);
});

test('the model is told which page and ticket tab the user is looking at', async (t) => {
  const actor = await user();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body).instructions);
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
  });
  await chat(config, actor, null, [{ role: 'user', content: 'show the details tab' }], {
    page: { path: '/tickets', ticketId: 'tes4-5', tab: 'discussion' },
  });
  assert.match(sent[0], /on \/tickets with ticket TES4-5 open on its discussion tab/);
  assert.match(sent[0], /"This ticket" means TES4-5/);
});

const roleUser = (role) => user({ role, roles: [role] });

test('stage moves are only offered to people who work the board, and only moves that would succeed are drafted', async () => {
  const admin = await roleUser(ROLE_IDS.ADMIN);
  const developer = await roleUser(ROLE_IDS.DEVELOPER);
  const readOnly = await roleUser(ROLE_IDS.READ_ONLY);
  const web = await project();
  const ticket = await createTicket(admin, { project: web.id, title: 'Chat inbox is empty' });
  await Ticket.updateOne({ ticketId: ticket.ticketId }, { $set: { assignedTo: developer._id } });
  const move = (actor, to, note = null) => runTool('propose_stage_change', JSON.stringify({ ticket_ids: [ticket.ticketId], to_stage: to, note }), ctxFor(actor));

  assert.equal(toolsFor(readOnly, null).some((t) => t.name === 'propose_stage_change'), false, 'read-only never gets it');
  assert.match((await move(readOnly, 'under_review')).error, /not available/);

  // A developer can't triage a pending ticket: explained, with what they can do instead.
  const refused = await move(developer, 'under_review');
  assert.ok(refused.error, 'no doomed draft');
  assert.match(refused.error, /can(not|'t) move|can move .* to:/);

  const ctx = ctxFor(admin);
  const ok = await runTool('propose_stage_change', JSON.stringify({ ticket_ids: [ticket.ticketId], to_stage: 'under_review', note: null }), ctx);
  assert.equal(ok.status, 'proposed');
  assert.equal(ctx.actions[0].to, 'under_review');
});

test('a move that needs estimate dates is explained instead of drafted', async () => {
  const admin = await roleUser(ROLE_IDS.ADMIN);
  const web = await project();
  const ticket = await createTicket(admin, { project: web.id, title: 'Chat inbox is empty' });
  await Ticket.updateOne({ ticketId: ticket.ticketId }, { $set: { status: 'live', assignedTo: admin._id } });
  const result = await runTool('propose_stage_change', JSON.stringify({ ticket_ids: [ticket.ticketId], to_stage: 'closed', note: 'done' }), ctxFor(admin));
  assert.match(result.error, /estimated resolution date and an expected release date/);
});

test('ticket details say where this user can move it', async () => {
  const admin = await roleUser(ROLE_IDS.ADMIN);
  const developer = await roleUser(ROLE_IDS.DEVELOPER);
  const web = await project();
  const ticket = await createTicket(admin, { project: web.id, title: 'Chat inbox is empty' });
  await Ticket.updateOne({ ticketId: ticket.ticketId }, { $set: { assignedTo: developer._id } });
  const asAdmin = await runTool('get_ticket', JSON.stringify({ ticket_id: ticket.ticketId }), ctxFor(admin));
  const asDev = await runTool('get_ticket', JSON.stringify({ ticket_id: ticket.ticketId }), ctxFor(developer));
  assert.ok(asAdmin.you_can_move_to.includes('Under Review'));
  assert.equal(asDev.you_can_move_to.includes('Under Review'), false);
});

test('voice navigation follows the app’s page rules for internal staff too', async () => {
  const admin = await roleUser(ROLE_IDS.ADMIN);
  const unassigned = await roleUser(ROLE_IDS.UNASSIGNED);
  const go = (actor, destination) => runTool('navigate', navArgs({ destination }), ctxFor(actor));
  assert.equal((await go(admin, 'users')).status, 'opened');
  for (const page of ['users', 'teams', 'projects', 'board', 'tickets']) {
    assert.match((await go(unassigned, page)).error, /doesn't have access/, page);
  }
  assert.equal((await go(unassigned, 'profile')).status, 'opened', 'open pages stay open');
});


const okReply = (text) => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200 });

test('the model knows the user’s projects and how to resolve a garbled or named reference', async (t) => {
  const actor = await user();
  await Project.create({ key: 'TES4', name: 'Test Final Web', createdBy: actor._id });
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body).instructions);
    return okReply('ok');
  });
  await chat(config, actor, null, [{ role: 'user', content: 'open test final spike ticket five' }]);
  assert.match(sent[0], /Projects this user can see: .*TES4 = Test Final Web/);
  assert.match(sent[0], /"TS4", "STES", "test final"/);
});

test('when lookups run out it still answers from what it found, with tools switched off', async (t) => {
  const actor = await user();
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.tool_choice === 'none') return okReply('I found TES4-5 but not the other one. Which project did you mean?');
    return new Response(JSON.stringify({
      output: [{ type: 'function_call', name: 'search_tickets', call_id: `c${bodies.length}`, arguments: JSON.stringify({ query: 'x' }) }],
    }), { status: 200 });
  });
  const out = await chat(config, actor, null, [{ role: 'user', content: 'find it' }]);
  assert.equal(out.reply, 'I found TES4-5 but not the other one. Which project did you mean?');
  assert.equal(bodies.length, 9, 'eight lookup rounds, then one answer');
  assert.match(bodies[8].instructions, /used all your lookups/);
});

test('"UI & QA" is a page it can open, separate from a ticket’s QA report tab', async () => {
  const admin = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const unassigned = await user({ role: ROLE_IDS.UNASSIGNED, roles: [ROLE_IDS.UNASSIGNED] });
  const ctx = ctxFor(admin);
  await runTool('navigate', navArgs({ destination: 'ui_qa' }), ctx);
  assert.equal(ctx.actions[0].href, '/ui-qa');
  assert.match((await runTool('navigate', navArgs({ destination: 'ui_qa' }), ctxFor(unassigned))).error, /doesn't have access/);
});

test('the transcriber is told the project keys and names to listen for', async (t) => {
  const { transcribe } = await import('../openai.client.js');
  let prompt = '';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    prompt = init.body.get('prompt');
    return new Response(JSON.stringify({ text: 'open TES4-5' }), { status: 200 });
  });
  await transcribe(
    { assistant: { apiKey: 'k', transcribeModel: 'm' } },
    { buffer: Buffer.from('x'), mimetype: 'audio/webm' },
    { vocabulary: [{ key: 'TES4', name: 'Test Final Web' }, { key: 'WEB2', name: 'Website' }] },
  );
  assert.match(prompt, /TES4 \(Test Final Web\), TES4-2; WEB2 \(Website\), WEB2-2/);
  assert.match(prompt, /Discussion, Details, Attachments, History/, 'tab names, so "discussion" is heard right');
  assert.doesNotMatch(prompt, /look like/, 'no instruction sentences for the model to echo back');
});

test('an echo of the transcriber hint is dropped as silence; real speech, even short, is kept', async (t) => {
  const { transcribe, isPromptEcho } = await import('../openai.client.js');
  const replies = ['A person talks about software tickets and projects in English', 'Discussion'];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ text: replies.shift() }), { status: 200 }));
  const cfg = { assistant: { apiKey: 'k', transcribeModel: 'm' } };
  const audio = { buffer: Buffer.from('x'), mimetype: 'audio/webm' };
  assert.equal((await transcribe(cfg, audio)).text, '');
  assert.equal((await transcribe(cfg, audio)).text, 'Discussion');
  assert.equal(isPromptEcho('open the discussion tab of TES4-2', 'Discussion, Details; TES4 (Test), TES4-2'), false);
});

test('the transcriber is told to keep Hinglish word for word, and a real Hinglish request is never dropped as an echo', async (t) => {
  const { transcribe } = await import('../openai.client.js');
  let prompt = '';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    prompt = init.body.get('prompt');
    return new Response(JSON.stringify({ text: 'Isko Under Review mein move kar do' }), { status: 200 });
  });
  const { text } = await transcribe({ assistant: { apiKey: 'k', transcribeModel: 'm' } }, { buffer: Buffer.from('x'), mimetype: 'audio/webm' });
  assert.equal(text, 'Isko Under Review mein move kar do');
  assert.match(prompt, /never translate/);
  assert.match(prompt, /Latin script, like: "TES4-2 ka status kya hai\?/);
});

test('every voice clip gets the same steady style, when the speech model supports it', async (t) => {
  const { speak } = await import('../openai.client.js');
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(Buffer.from('mp3'), { status: 200 });
  });
  await speak({ assistant: { apiKey: 'k', speechModel: 'gpt-4o-mini-tts', speechVoice: 'marin' } }, 'Moved TES4-3.');
  await speak({ assistant: { apiKey: 'k', speechModel: 'gpt-4o-mini-tts', speechVoice: 'marin' } }, 'It now waits for review.');
  await speak({ assistant: { apiKey: 'k', speechModel: 'tts-1', speechVoice: 'alloy' } }, 'Hi.');
  assert.match(bodies[0].instructions, /steady/);
  assert.equal(bodies[0].instructions, bodies[1].instructions, 'both parts of a reply sound alike');
  assert.equal('instructions' in bodies[2], false, 'tts-1 does not take instructions');
});

test('Hindi and English replies get their own voice and accent', async (t) => {
  const { speak } = await import('../openai.client.js');
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(Buffer.from('mp3'), { status: 200 });
  });
  const cfg = { assistant: { apiKey: 'k', speechModel: 'gpt-4o-mini-tts', speechVoice: 'marin', speechVoiceHindi: 'coral' } };
  await speak(cfg, 'Moved TES4-3 to Under Review.');
  await speak(cfg, 'TES4-3 ko Under Review mein move kar diya hai.');
  await speak(cfg, 'It now waits for review.', { language: 'hi' }); // the reply's language wins over the part's
  assert.deepEqual(bodies.map((body) => body.voice), ['marin', 'coral', 'coral']);
  assert.match(bodies[0].instructions, /neutral English accent/);
  assert.match(bodies[1].instructions, /native Hindi speaker/);
});

const TICKET_NONE = {
  stage: null, priority: null, category: null, severity: null, scope: null, owner: null, module: null,
  search: null, blocked: null, overdue: null, reopened: null, new_reply: null, view: null, clear_all: null,
  sort_by: null, sort_direction: null, rows: null,
};
const ticketFilters = (ctx, over) => runTool('set_ticket_filters', JSON.stringify({ ...TICKET_NONE, ...over }), ctx);

test('set_ticket_filters: "any" clears (search too), and a second call in the message merges', async () => {
  const ctx = ctxFor(await user());
  await ticketFilters(ctx, { stage: 'any', search: 'any' });
  await ticketFilters(ctx, { priority: 'High', overdue: true, view: 'modules' });
  assert.deepEqual(ctx.actions.map(({ id: _id, ...action }) => action), [
    { type: 'ticket_filters', filters: { status: '', q: '', priority: 'High', overdue: true }, view: 'modules' },
  ]);
  const nothing = await ticketFilters(ctxFor(await user()), {});
  assert.match(nothing.error, /Nothing to change/);
  const halfSort = await ticketFilters(ctxFor(await user()), { sort_direction: 'asc' });
  assert.match(halfSort.error, /Give sort_by too/);
});

test('set_ticket_filters matches the owner on the server and sends their id', async () => {
  const admin = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const riya = await user({ name: 'Riya Sen' });
  const rajesh = await user({ name: 'Rajesh Kumar' });
  const raj = await user({ name: 'Raj Mehta' });
  const web = await project();
  for (const owner of [riya, rajesh, raj]) {
    const ticket = await createTicket(admin, { project: web.id, title: `Ticket for ${owner.name}` });
    await Ticket.updateOne({ ticketId: ticket.ticketId }, { assignedTo: owner._id });
  }
  const ctx = ctxFor(admin);
  const found = await ticketFilters(ctx, { owner: 'riya' });
  assert.equal(found.owner, 'Riya Sen');
  assert.equal(ctx.actions[0].filters.assignedTo, String(riya._id));
  const ambiguous = await ticketFilters(ctxFor(admin), { owner: 'raj' });
  assert.match(ambiguous.error, /matches Rajesh Kumar .*Raj Mehta|matches Raj Mehta .*Rajesh Kumar/);
  const exact = ctxFor(admin);
  await ticketFilters(exact, { owner: 'Raj Mehta' });
  assert.equal(exact.actions[0].filters.assignedTo, String(raj._id));
  const nobody = await ticketFilters(ctxFor(admin), { owner: 'Priya' });
  assert.match(nobody.error, /No ticket owner called "Priya"\. Owners: .*Riya Sen/);
});

test('one message changes one page: a second page is refused, not silently lost', async () => {
  const ctx = ctxFor(await user());
  await ticketFilters(ctx, { priority: 'High' });
  const board = await runTool('navigate', navArgs({ destination: 'board' }), ctx);
  assert.match(board.error, /Not done: this message already works on Tickets/);
  assert.deepEqual(ctx.actions.map((action) => action.type), ['ticket_filters']);
});

test('change_page refuses pages without numbered pages, and the module view', async () => {
  const actor = await user();
  const onBoard = { ...ctxFor(actor), page: { path: '/tickets/board', query: '' } };
  assert.match((await runTool('change_page', JSON.stringify({ direction: 'next', page_number: null }), onBoard)).error,
    /Paging works on Tickets, People, Projects, Teams; the user is on \/tickets\/board/);
  const inModules = { ...ctxFor(actor), page: { path: '/tickets', query: '?view=modules' } };
  assert.match((await runTool('change_page', JSON.stringify({ direction: 'next', page_number: null }), inModules)).error,
    /no pages/);
  const onTable = { ...ctxFor(actor), page: { path: '/tickets', query: '?page=2' } };
  await runTool('change_page', JSON.stringify({ direction: 'next', page_number: null }), onTable);
  assert.deepEqual(onTable.actions.map(({ id: _id, ...action }) => action), [{ type: 'change_page', direction: 'next' }]);
});

test('download_report needs a report in the chat', async () => {
  const admin = { role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] };
  const none = await runTool('download_report', '{}', ctxFor(await user(admin)));
  assert.match(none.error, /no report in this chat/);
  const ctx = { ...ctxFor(await user(admin)), hasReport: true };
  await runTool('download_report', '{}', ctx);
  assert.deepEqual(ctx.actions.map((action) => action.type), ['report_download']);
});

test('propose_update_ticket asks for the page when the module changes, so the card cannot fail on confirm', async () => {
  const actor = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const web = await Project.create({
    key: 'WEB', name: 'Web App', createdBy: new mongoose.Types.ObjectId(),
    modules: [{ label: 'Chats', pages: [{ label: 'Inbox' }] }, { label: 'Billing', pages: [{ label: 'Invoices' }] },
      { label: 'Help', pages: [] }],
  });
  const ticket = await createTicket(actor, { project: web.id, title: 'Chat inbox is empty', module: 'Chats', page: 'Inbox' });
  const base = {
    ticket_id: ticket.ticketId, title: null, description: null, steps_to_reproduce: null, priority: null, severity: null,
    category: null, environment: null, module: null, page: null, due_date: null, release_date: null,
  };
  const ask = await runTool('propose_update_ticket', JSON.stringify({ ...base, module: 'Billing' }), ctxFor(actor));
  assert.match(ask.error, /Which page in Billing\? One of: Invoices/);
  const bad = await runTool('propose_update_ticket', JSON.stringify({ ...base, module: 'Billing', page: 'Inbox' }), ctxFor(actor));
  assert.match(bad.error, /"Inbox" is not a page of "Billing"/);
  const ctx = ctxFor(actor);
  await runTool('propose_update_ticket', JSON.stringify({ ...base, module: 'Help' }), ctx);
  assert.deepEqual(ctx.actions[0].changes, { module: 'Help', page: '' });
});

test('set_ticket_filters sorts and sets rows per page', async () => {
  const ctx = ctxFor(await user());
  await ticketFilters(ctx, { sort_by: 'owner', sort_direction: 'asc', rows: 50 });
  assert.deepEqual(ctx.actions.map(({ id: _id, ...action }) => action), [
    { type: 'ticket_filters', filters: {}, sort: { column: 'owner', direction: 'asc' }, limit: 50 },
  ]);
});

test('set_page_filters maps fields to the page URL and refuses ones the page lacks', async () => {
  const ctx = ctxFor(await user());
  const none = {
    search: null, mine: null, unread: null, team_scope: null, team_status: null, trend_group_by: null,
    throughput_group_by: null, window_days: null, breakdown: null, audit_category: null, audit_action: null,
    audit_order: null, rows: null,
  };
  const pageFilters = (context, over) => runTool('set_page_filters', JSON.stringify({ ...none, ...over }), context);
  await pageFilters(ctx, { page: 'board', mine: true });
  const everyone = ctxFor(await user());
  await pageFilters(everyone, { page: 'board', mine: false });
  const unread = ctxFor(await user());
  await pageFilters(unread, { page: 'notifications', unread: true });
  const stray = await pageFilters(ctxFor(await user()), { page: 'board', search: 'x' });
  assert.match(stray.error, /Board has no search filter/);
  const analyst = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const window = await pageFilters(ctxFor(analyst), { page: 'analytics', window_days: 7 });
  assert.match(window.error, /one of 14, 30, 60, 90 days/);
  assert.deepEqual([...ctx.actions, ...everyone.actions, ...unread.actions].map(({ id: _id, ...action }) => action), [
    { type: 'page_filters', path: '/tickets/board', params: { mine: '1' } },
    // Explicit 0, or the Board falls back to the saved choice.
    { type: 'page_filters', path: '/tickets/board', params: { mine: '0' } },
    { type: 'page_filters', path: '/notifications', params: { unread: '1' } },
  ]);
});

test('control_module_view records each step; modules null means every module', async () => {
  await Project.create({
    key: 'CAT', name: 'Catalog', createdBy: new mongoose.Types.ObjectId(),
    modules: [{ label: 'ATS', pages: [] }, { label: 'Master Catalog', pages: [] }],
  });
  const ctx = ctxFor(await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] }));
  await runTool('control_module_view', JSON.stringify({ action: 'collapse', modules: null, order: null, except: null }), ctx);
  await runTool('control_module_view', JSON.stringify({
    action: 'expand', modules: [' ATS '], order: 'attention', except: null,
  }), ctx);
  await runTool('control_module_view', JSON.stringify({
    action: 'collapse', modules: null, order: null, except: ['master catalog'],
  }), ctx);
  const misheard = await runTool('control_module_view', JSON.stringify({
    action: 'expand', modules: ['Master Kit Logo'], order: null, except: null,
  }), ctx);
  assert.match(misheard.error, /No module named "Master Kit Logo"\. Modules: .*Master Catalog/);
  const empty = await runTool('control_module_view', JSON.stringify({ action: null, modules: null, order: null, except: null }), ctx);
  assert.match(empty.error, /Pass an action/);
  assert.deepEqual(ctx.actions.map(({ id: _id, ...action }) => action), [
    { type: 'module_view', action: 'collapse', modules: null, order: null },
    { type: 'module_view', action: 'expand', modules: ['ATS'], order: 'attention' },
    { type: 'module_view', action: 'collapse', modules: null, order: null, except: ['Master Catalog'] },
  ]);
});

test("get_notification_settings reads the user's own settings", async () => {
  const actor = await user();
  actor.notificationPrefs.email.set('TICKET_COMMENTED', true);
  actor.notificationPrefs.inApp.set('TICKET_CLOSED', false);
  await actor.save();
  const settings = await runTool('get_notification_settings', '{}', ctxFor(actor));
  const row = (event) => settings.find((setting) => setting.event === event);
  assert.deepEqual(row('TICKET_COMMENTED'), { event: 'TICKET_COMMENTED', label: 'New comment', in_app: true, email: true });
  assert.deepEqual(row('TICKET_CLOSED'), { event: 'TICKET_CLOSED', label: 'Closed', in_app: false, email: true });
  assert.deepEqual(row('TICKET_ESTIMATE_SET'), {
    event: 'TICKET_ESTIMATE_SET', label: 'Dates updated', in_app: true, email: false,
  });
});

test('propose_notification_settings drafts only real changes, and restoring defaults lists what resets', async () => {
  const actor = await user();
  actor.notificationPrefs.email.set('TICKET_COMMENTED', true);
  await actor.save();
  const ctx = ctxFor(actor);
  await runTool('propose_notification_settings', JSON.stringify({
    changes: [
      { event: 'TICKET_COMMENTED', in_app: true, email: false },
      { event: 'TICKET_CLOSED', in_app: null, email: true },
    ],
    restore_defaults: null,
  }), ctx);
  await runTool('propose_notification_settings', JSON.stringify({ changes: null, restore_defaults: true }), ctx);
  const noop = await runTool('propose_notification_settings', JSON.stringify({
    changes: [{ event: 'TICKET_CLOSED', in_app: true, email: true }], restore_defaults: null,
  }), ctx);
  assert.match(JSON.stringify(noop), /already/);
  const commented = { event: 'TICKET_COMMENTED', label: 'New comment', email: { from: true, to: false } };
  assert.deepEqual(ctx.actions.map(({ id: _id, ...action }) => action), [
    { type: 'notification_settings', settings: [commented] },
    { type: 'notification_settings', settings: [commented], reset: true },
  ]);
});

test('get_analytics runs the Analytics numbers for one project, only for roles that can see Analytics', async () => {
  const admin = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const web = await project();
  const other = await Project.create({ key: 'ATS', name: 'ATS', createdBy: new mongoose.Types.ObjectId() });
  await createTicket(admin, { project: web.id, title: 'Chat inbox is empty', severity: 'Critical' });
  await createTicket(admin, { project: web.id, title: 'Send button is grey', severity: 'Minor' });
  await createTicket(admin, { project: other.id, title: 'Not in WEB' });

  const result = await runTool('get_analytics', JSON.stringify({
    project_key: 'WEB', breakdown: 'severity', window_days: null,
    stage: null, priority: null, severity: null, category: null, module: null,
  }), ctxFor(admin));
  assert.equal(result.project, 'Web App (WEB)');
  assert.equal(result.tickets, 2);
  assert.equal(result.blocker_or_critical, 1);
  assert.equal(result.delivery.window_days, 30);
  assert.deepEqual(result.breakdown.rows.map((row) => row.key).sort(), ['Critical', 'Minor']);

  const names = (tools) => tools.map((tool) => tool.name);
  assert.ok(names(toolsFor(admin, null)).includes('get_analytics'));
  assert.ok(!names(toolsFor(await user(), null)).includes('get_analytics'));
});

test('create_project_report shows a report card for the period; download_report asks for the document', async () => {
  const admin = await user({ role: ROLE_IDS.ADMIN, roles: [ROLE_IDS.ADMIN] });
  const web = await project();
  const first = await createTicket(admin, { project: web.id, title: 'Chat inbox is empty' });
  await createTicket(admin, { project: web.id, title: 'Send button is grey' });
  await Ticket.updateOne({ ticketId: first.ticketId }, {
    blocked: true, blockerReason: 'Waiting on the API', estimatedResolutionAt: new Date(Date.now() - 86400000),
    assignedTo: admin._id,
  });
  const ctx = ctxFor(admin);

  const result = await runTool('create_project_report', JSON.stringify({
    project_key: 'WEB', days: null, from: null, to: null,
  }), ctx);
  const { report } = ctx.actions[0];
  assert.equal(ctx.actions[0].type, 'report');
  assert.deepEqual(result.report, report);
  assert.deepEqual(report.project, { key: 'WEB', name: 'Web App' });
  assert.equal(report.totals.created, 2);
  assert.equal(report.totals.open, 2);
  assert.deepEqual(report.overdue_tickets.map((ticket) => ticket.id), [first.ticketId]);
  assert.deepEqual(report.blocked_tickets.map((ticket) => ticket.reason), ['Waiting on the API']);
  assert.deepEqual(report.open_by_owner, [{ name: 'Ada', open: 1 }, { name: 'Unassigned', open: 1 }]);
  assert.equal(new Date(report.to) - new Date(report.from), 7 * 86400000);

  const old = await runTool('create_project_report', JSON.stringify({
    project_key: 'WEB', days: null, from: '2020-01-01', to: '2020-01-31',
  }), ctx);
  assert.equal(old.report.totals.created, 0);
  const backwards = await runTool('create_project_report', JSON.stringify({
    project_key: 'WEB', days: null, from: '2020-02-01', to: '2020-01-01',
  }), ctx);
  assert.match(JSON.stringify(backwards), /starts after it ends/);

  await runTool('download_report', '{}', ctx);
  assert.equal(ctx.actions.at(-1).type, 'report_download');
});
