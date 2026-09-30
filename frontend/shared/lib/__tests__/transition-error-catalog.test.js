import { describe, it, expect } from 'vitest';
import {
  lookupTransitionErrorCode,
  resolveBlockReasonDisplay,
  resolveApiErrorDisplay,
} from '../transition-error-catalog.js';

describe('transition-error-catalog', () => {
  it('maps SAME_STAGE to noop with catalog copy', () => {
    const entry = lookupTransitionErrorCode('SAME_STAGE');
    expect(entry?.severity).toBe('noop');
    expect(entry?.logLevel).toBe('none');
    expect(entry?.title).toBe('No stage change');

    const display = resolveBlockReasonDisplay({
      code: 'SAME_STAGE',
      message: 'The ticket is already in In progress',
      toLabel: 'In progress',
    });
    expect(display.severity).toBe('noop');
    expect(display.surface.banner).toBe(false);
    expect(display.message).toMatch(/already in In progress/i);
  });

  it('maps CLIENT_BOARD_MOVE_FORBIDDEN without server logging by default', () => {
    const display = resolveBlockReasonDisplay({
      code: 'CLIENT_BOARD_MOVE_FORBIDDEN',
      message: 'Nope',
    });
    expect(display.logLevel).toBe('none');
    expect(display.title).toBe('Cannot move this ticket');
  });

  it('maps STAGE_CONFLICT to toast refresh copy', () => {
    const display = resolveApiErrorDisplay({
      code: 'STAGE_CONFLICT',
      status: 409,
      message: 'conflict',
    });
    expect(display.severity).toBe('conflict');
    expect(display.surface.toast).toBe(true);
    expect(display.message).toMatch(/changed elsewhere/i);
  });
});
