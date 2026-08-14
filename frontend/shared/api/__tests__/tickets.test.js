import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setAccessToken } from '../client.js';
import { resolveAttachmentDownloadUrl } from '../tickets.js';

describe('resolveAttachmentDownloadUrl', () => {
  beforeEach(() => {
    setAccessToken('token-abc');
    global.fetch = vi.fn();
  });

  it('returns the presigned URL from the authorized download endpoint', async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://s3.example/presigned.png' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(resolveAttachmentDownloadUrl('WEB-101', 'att-1'))
      .resolves.toBe('https://s3.example/presigned.png');

    expect(global.fetch.mock.calls[0][0]).toBe(
      'http://localhost:4000/v1/tickets/WEB-101/attachments/att-1/download',
    );
    const [, options] = global.fetch.mock.calls[0];
    const headers = options.headers;
    const auth = typeof headers.get === 'function'
      ? headers.get('Authorization')
      : headers.Authorization;
    const accept = typeof headers.get === 'function'
      ? headers.get('Accept')
      : headers.Accept;

    expect(auth).toBe('Bearer token-abc');
    expect(accept).toBe('application/json');
  });
});
