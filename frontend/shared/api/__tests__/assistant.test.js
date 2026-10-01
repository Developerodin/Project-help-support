import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { setAccessToken } from '../client.js';
import { streamAssistantMessage } from '../assistant.js';

/** The server's event stream, cut into 5-byte pieces so events straddle chunks. */
function ndjson(events, status = 200) {
  const bytes = new TextEncoder().encode(events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
      controller.close();
    },
  }), { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}

const messages = [{ role: 'user', content: 'status of WEB-1?' }];

describe('streamAssistantMessage', () => {
  beforeEach(() => {
    setAccessToken('token-abc');
    global.fetch = vi.fn();
  });

  it('asks for a stream, hands over the text so far, and resolves with the finished reply', async () => {
    global.fetch.mockResolvedValueOnce(ndjson([
      { type: 'delta', text: 'Let me check.\n' },
      { type: 'reset' },
      { type: 'delta', text: 'WEB-1 is ' },
      { type: 'delta', text: 'In Progress.' },
      {
        type: 'done', reply: 'WEB-1 is In Progress.', actions: [{ type: 'navigate' }], sig: 'f'.repeat(64),
      },
    ]));
    const seen = [];

    const result = await streamAssistantMessage(messages, { onText: (text) => seen.push(text) });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ messages, stream: true });
    expect(seen).toEqual(['Let me check.\n', '', 'WEB-1 is ', 'WEB-1 is In Progress.']);
    expect(result).toEqual({ reply: 'WEB-1 is In Progress.', actions: [{ type: 'navigate' }], sig: 'f'.repeat(64) });
  });

  it('throws the error the stream ends with', async () => {
    global.fetch.mockResolvedValueOnce(ndjson([
      { type: 'delta', text: 'WEB-1' },
      { type: 'error', error: { code: 'ASSISTANT_UPSTREAM', message: 'The assistant is unavailable right now.' } },
    ]));
    await expect(streamAssistantMessage(messages)).rejects.toMatchObject({ code: 'ASSISTANT_UPSTREAM' });
  });

  it('throws when the stream stops without an answer', async () => {
    global.fetch.mockResolvedValueOnce(ndjson([{ type: 'delta', text: 'WEB-1' }]));
    await expect(streamAssistantMessage(messages)).rejects.toMatchObject({ code: 'ASSISTANT_STREAM_ENDED' });
  });

  it('throws an ordinary error response before any stream as usual', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'ASSISTANT_DAILY_LIMIT', message: 'You have used today\'s allowance.' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    await expect(streamAssistantMessage(messages)).rejects.toMatchObject({ code: 'ASSISTANT_DAILY_LIMIT' });
  });
});
