import {
  after, afterEach, before, beforeEach, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLE_IDS } from '@pms/shared';
import {
  startTestDb, stopTestDb, createActiveUser, bearerToken, getTestConfig,
} from '../../../test/test-harness.js';
import { createApp } from '../../../app.js';
import { chat } from '../assistant.service.js';
import { REPLY_MAX_CHARS, SCOPE_REFUSAL, capReply } from '../assistant.scope.js';
import { createResponse } from '../openai.client.js';

/*
 * Streamed replies: text reaches the user as the model writes it, but never
 * before the classifier has passed the message and never past what the reply
 * checks would allow in a whole reply.
 */

const encoder = new TextEncoder();

/** OpenAI's event stream, cut into 7-byte pieces so events straddle chunks. */
function sse(events) {
  const bytes = encoder.encode(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const deltas = (pieces) => pieces.map((delta) => ({ type: 'response.output_text.delta', delta }));
const completed = (output) => ({ type: 'response.completed', response: { output, usage: { input_tokens: 10, output_tokens: 5 } } });
const message = (text) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
/** A streamed text reply, written in the given pieces. */
const streamed = (pieces) => sse([...deltas(pieces), completed(message(pieces.join('')))]);

const realFetch = globalThis.fetch;
let replies;
let bodies;

function fakeOpenAI() {
  bodies = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const next = replies.shift();
    return typeof next === 'function' ? next(body) : next;
  };
}

describe('streamed replies', () => {
  let config;
  let app;
  let dev;
  const auth = () => bearerToken(dev, config);

  before(async () => {
    await startTestDb();
    config = {
      ...getTestConfig(),
      assistant: {
        apiKey: 'sk-test', chatModel: 'chat-m', userDailyBudgetInr: 100, usdToInr: 88, budgetTimeZone: 'Asia/Kolkata',
        monthlyTokenBudget: 1_000_000, prices: { chatInputPerM: 1, chatOutputPerM: 1, transcribePerMin: 1, speechPerMin: 1 },
      },
    };
    app = createApp(config);
    dev = await createActiveUser({ email: 'dev-stream@example.com', roles: [ROLE_IDS.DEVELOPER] });
  });

  after(stopTestDb);

  beforeEach(() => {
    replies = [];
    fakeOpenAI();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const ask = (content, { onStream, scopeModel } = {}) => chat(
    { ...config, assistant: { ...config.assistant, scopeModel } },
    dev,
    {},
    [{ role: 'user', content }],
    { onStream },
  );

  describe('createResponse', () => {
    it('hands over text as it arrives and returns the finished response', async () => {
      replies.push(streamed(['WEB-1 is ', 'In Progress.']));
      const pieces = [];
      const response = await createResponse(config, { instructions: 'x', input: [], onText: (text) => pieces.push(text) });
      assert.equal(bodies[0].stream, true);
      assert.deepEqual(pieces, ['WEB-1 is ', 'In Progress.']);
      assert.equal(response.output[0].content[0].text, 'WEB-1 is In Progress.');
    });

    it('turns a failed stream into the usual upstream error', async () => {
      replies.push(sse([...deltas(['Half']), { type: 'response.failed', response: {} }]));
      await assert.rejects(
        createResponse(config, { instructions: 'x', input: [], onText: () => {} }),
        (err) => err.statusCode === 502 && err.code === 'ASSISTANT_UPSTREAM',
      );
      replies.push(sse(deltas(['Cut off'])));
      await assert.rejects(
        createResponse(config, { instructions: 'x', input: [], onText: () => {} }),
        (err) => err.code === 'ASSISTANT_UPSTREAM',
      );
    });
  });

  describe('chat', () => {
    it('streams the reply, and the finished reply is the same text', async () => {
      replies.push(streamed(['WEB-1 is In Progress.\n', 'It is assigned to Priya.']));
      const events = [];
      const turn = await ask('status of WEB-1?', { onStream: (event) => events.push(event) });
      assert.equal(turn.reply, 'WEB-1 is In Progress.\nIt is assigned to Priya.');
      assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'WEB-1 is In Progress.\n');
    });

    it('shows nothing when the classifier refuses the message', async () => {
      replies.push(
        (body) => (body.model === 'scope-m' ? new Response(JSON.stringify({ output_text: '{"in_scope":false}', usage: {} })) : streamed(['Paris is the capital.\n'])),
        (body) => (body.model === 'scope-m' ? new Response(JSON.stringify({ output_text: '{"in_scope":false}', usage: {} })) : streamed(['Paris is the capital.\n'])),
      );
      const events = [];
      const turn = await ask('quelle est la capitale de la France ?', { onStream: (event) => events.push(event), scopeModel: 'scope-m' });
      assert.equal(turn.reply, SCOPE_REFUSAL);
      assert.deepEqual(events, []);
    });

    it('drops text that led into a lookup', async () => {
      replies.push(
        sse([...deltas(['Let me check that for you, one moment while I look.\n']), completed([
          { type: 'function_call', name: 'scroll_page', arguments: '{"direction":"down"}', call_id: 'c1' },
        ])]),
        streamed(['Scrolled down.\n']),
      );
      const events = [];
      await ask('scroll down', { onStream: (event) => events.push(event) });
      assert.deepEqual(events.map((event) => event.type), ['delta', 'reset', 'delta']);
    });

    it('stops showing text once it would fail the reply checks, and the reply becomes the refusal', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `const value${i} = compute(${i});\n`);
      replies.push(streamed(lines));
      const events = [];
      const turn = await ask('what is overdue?', { onStream: (event) => events.push(event) });
      const shown = events.map((event) => event.text).join('');
      assert.ok(shown.split('\n').filter(Boolean).length <= 12, 'never more code than one reply may carry');
      assert.equal(turn.reply, SCOPE_REFUSAL);
    });
  });

  describe('reply length cap', () => {
    const paragraphs = (count) => Array.from({ length: count }, (_, i) => `WEB-${i + 1} is overdue, owned by Priya, due 2026-09-${String((i % 28) + 1).padStart(2, '0')}.`).join('\n\n');
    const NOTE = '\n\n(That\'s as much as fits in one reply.';

    it('capReply leaves a short reply alone and cuts a long one at a paragraph, with a note', () => {
      assert.equal(capReply('WEB-1 is done.'), 'WEB-1 is done.');
      const long = paragraphs(300);
      const cut = capReply(long);
      assert.ok(cut.length <= REPLY_MAX_CHARS);
      const kept = cut.slice(0, cut.indexOf(NOTE));
      assert.ok(kept.endsWith('.'), 'cut after a whole paragraph');
      assert.ok(long.startsWith(kept));
    });

    it('trims a long reply after a lookup instead of refusing it', async () => {
      replies.push(
        new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'list_projects', arguments: '{}', call_id: 'c1' }], usage: {} })),
        new Response(JSON.stringify({ output_text: paragraphs(300), output: [], usage: {} })),
      );
      const turn = await ask('list every overdue ticket');
      assert.ok(turn.reply.length <= REPLY_MAX_CHARS);
      assert.match(turn.reply, /Ask for a narrower list/);
    });

    it('still refuses an over-long reply that looked nothing up', async () => {
      replies.push(new Response(JSON.stringify({ output_text: paragraphs(300), output: [], usage: {} })));
      assert.equal((await ask('what is overdue?')).reply, SCOPE_REFUSAL);
    });
  });

  describe('POST /chat with stream', () => {
    const post = (body) => request(app).post('/v1/assistant/chat').set('Authorization', auth())
      .send({ messages: [{ role: 'user', content: 'status of WEB-1?' }], ...body })
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => done(null, text));
      });
    const events = (res) => res.body.split('\n').filter(Boolean).map((line) => JSON.parse(line));

    it('sends the text as it is written, then the signed reply', async () => {
      replies.push(streamed(['WEB-1 is In Progress.\n', 'Assigned to Priya.']));
      const res = await post({ stream: true });
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /application\/x-ndjson/);
      const [first, done] = events(res);
      assert.deepEqual(first, { type: 'delta', text: 'WEB-1 is In Progress.\n' });
      assert.equal(done.type, 'done');
      assert.equal(done.reply, 'WEB-1 is In Progress.\nAssigned to Priya.');
      assert.match(done.sig, /^[0-9a-f]{64}$/);
    });

    it('fails as an ordinary error response when nothing was sent yet', async () => {
      replies.push(new Response('down', { status: 500 }));
      const res = await post({ stream: true });
      assert.equal(res.status, 502);
      assert.equal(JSON.parse(res.body).error.code, 'ASSISTANT_UPSTREAM');
    });

    it('ends with an error event when the stream breaks after text was sent', async () => {
      replies.push(sse([...deltas(['WEB-1 is In Progress.\n']), { type: 'error', message: 'boom' }]));
      const res = await post({ stream: true });
      assert.equal(res.status, 200);
      const sent = events(res);
      assert.equal(sent[0].type, 'delta');
      assert.deepEqual(sent.at(-1), { type: 'error', error: { code: 'ASSISTANT_UPSTREAM', message: 'The assistant is unavailable right now. Try again shortly.' } });
    });

    it('still answers in one piece without stream', async () => {
      replies.push(new Response(JSON.stringify({ output_text: 'WEB-1 is done.', output: [], usage: {} })));
      const res = await post({});
      assert.equal(JSON.parse(res.body).reply, 'WEB-1 is done.');
      assert.equal(bodies[0].stream, undefined);
    });
  });
});
