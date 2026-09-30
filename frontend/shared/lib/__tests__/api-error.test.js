import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logApiError, shouldLogApiError } from '../api-error.js';

describe('shouldLogApiError', () => {
  it('suppresses SAME_STAGE and client preflight codes without requestId', () => {
    expect(shouldLogApiError({ code: 'SAME_STAGE', message: 'noop' })).toBe(false);
    expect(shouldLogApiError({ code: 'CLIENT_BOARD_MOVE_FORBIDDEN', message: 'nope' })).toBe(false);
    expect(shouldLogApiError({ code: 'BOARD_OPERATE_FORBIDDEN', message: 'nope' })).toBe(false);
  });

  it('respects error.log === false', () => {
    expect(shouldLogApiError({ code: 'SERVER_ERROR', message: 'x', log: false })).toBe(false);
  });

  it('allows server errors with request id', () => {
    expect(shouldLogApiError({
      code: 'SERVER_ERROR', status: 500, message: 'boom', requestId: 'req-1',
    })).toBe(true);
  });
});

describe('logApiError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log suppressed transition codes', () => {
    logApiError({ code: 'SAME_STAGE', message: 'already there' });
    expect(console.error).not.toHaveBeenCalled();
  });
});
