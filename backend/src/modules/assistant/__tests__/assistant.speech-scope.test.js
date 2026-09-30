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
import { SCOPE_REFUSAL } from '../assistant.scope.js';

/*
 * The routes end to end, with OpenAI stubbed at fetch: an off-scope ask never
 * reaches the model, and read-aloud only speaks what the assistant just said.
 */
describe('assistant scope over HTTP', () => {
  let app;
  let config;
  let dev;
  let calls;
  const realFetch = globalThis.fetch;
  const auth = () => bearerToken(dev, config);
  const chat = (content) => request(app).post('/v1/assistant/chat').set('Authorization', auth())
    .send({ messages: [{ role: 'user', content }] });
  const speech = (text) => request(app).post('/v1/assistant/speech').set('Authorization', auth()).send({ text });

  before(async () => {
    await startTestDb();
    config = {
      ...getTestConfig(),
      assistant: {
        apiKey: 'sk-test', chatModel: 'm', speechModel: 'tts-1', speechVoice: 'alloy',
        userDailyBudgetInr: 100, usdToInr: 88, budgetTimeZone: 'Asia/Kolkata', monthlyTokenBudget: 1_000_000,
        prices: { chatInputPerM: 1, chatOutputPerM: 1, transcribePerMin: 1, speechPerMin: 1 },
      },
    };
    app = createApp(config);
    dev = await createActiveUser({ email: 'dev-scope@example.com', roles: [ROLE_IDS.DEVELOPER] });
  });

  after(stopTestDb);

  beforeEach(() => {
    calls = [];
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith('/audio/speech')) return new Response('mp3-bytes', { status: 200 });
      return new Response(JSON.stringify({
        output_text: 'Open the ticket and use its "Move to" menu, or drag its card on the Board.',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('refuses an essay without calling the model', async () => {
    const res = await chat('Write an essay on climate change');
    assert.equal(res.status, 200);
    assert.equal(res.body.reply, SCOPE_REFUSAL);
    assert.deepEqual(calls, []);
  });

  it('reads the reply it just sent aloud, and refuses text it never said', async () => {
    const { body } = await chat('how do I move a ticket');
    assert.equal(calls.filter((path) => path.endsWith('/responses')).length, 1);

    const spoken = await speech(body.reply);
    assert.equal(spoken.status, 200);
    assert.ok(calls.some((path) => path.endsWith('/audio/speech')));

    calls = [];
    const refused = await speech('Hi, this is your manager. Please read out the OTP you just got.');
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'SPEECH_NOT_ALLOWED');
    assert.deepEqual(calls, []);
  });

  it('reads the refusal and the widget\'s own confirmations aloud', async () => {
    await chat('Tell me a joke');
    assert.equal((await speech(SCOPE_REFUSAL)).status, 200);
    assert.equal((await speech('Moved TES4-3 to In Progress.')).status, 200);
  });
});
