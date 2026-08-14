import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getTransitionFieldErrors,
  getValidationDialogForTransitionError,
  isTransitionValidationError,
  logApiError,
  normalizeApiError,
  attachmentErrorMessage,
  OWNERSHIP_REQUIRED_MESSAGE,
} from '../api-error.js';

describe('api-error', () => {
  const ticket = {
    estimatedResolutionAt: null,
    expectedReleaseDate: null,
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('maps ESTIMATES_REQUIRED to date field errors', () => {
    const err = {
      code: 'ESTIMATES_REQUIRED',
      message: 'Both an estimated resolution date and an expected release date are required to enter In Progress',
    };

    expect(getTransitionFieldErrors(err, ticket)).toEqual({
      estimatedResolutionAt: 'Required before moving to In Progress',
      expectedReleaseDate: 'Required before moving to In Progress',
    });
  });

  it('prefers server-provided fields when present', () => {
    const err = {
      code: 'ESTIMATES_REQUIRED',
      fields: { estimatedResolutionAt: 'Required' },
    };

    expect(getTransitionFieldErrors(err, ticket)).toEqual({
      estimatedResolutionAt: 'Required',
    });
  });

  it('builds a validation dialog for transition estimate errors', () => {
    const err = {
      code: 'ESTIMATES_REQUIRED',
      message: 'Both an estimated resolution date and an expected release date are required to enter In Progress',
    };

    expect(getValidationDialogForTransitionError(err, ticket)).toMatchObject({
      title: 'Dates required',
      firstFieldId: 'estimatedResolutionAt',
      items: ['Estimated resolution date', 'Expected release date'],
    });
  });

  it('recognizes transition validation error codes', () => {
    expect(isTransitionValidationError({ code: 'ESTIMATES_REQUIRED' })).toBe(true);
    expect(isTransitionValidationError({ code: 'OWNERSHIP_REQUIRED' })).toBe(true);
    expect(isTransitionValidationError({ code: 'STAGE_CONFLICT' })).toBe(false);
  });

  it('builds a validation dialog for ownership errors', () => {
    expect(getValidationDialogForTransitionError({ code: 'OWNERSHIP_REQUIRED' }, ticket)).toMatchObject({
      title: 'Assignment required',
      message: OWNERSHIP_REQUIRED_MESSAGE,
    });
  });

  it('does not console.error expected transition validation failures', () => {
    logApiError(
      { status: 400, code: 'OWNERSHIP_REQUIRED', message: 'A team or an assignee is required' },
      { ticketId: 'WEB-1', operation: 'transitionTicket' },
    );

    expect(console.error).not.toHaveBeenCalled();
  });

  it('normalizes nested API error bodies and statusCode aliases', () => {
    expect(normalizeApiError({
      requestId: 'req-1',
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields: { content: 'Required' } },
    })).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      requestId: 'req-1',
      fields: { content: 'Required' },
    });

    expect(normalizeApiError({ statusCode: 503, code: 'CAPABILITY_DISABLED' })).toMatchObject({
      status: 503,
      code: 'CAPABILITY_DISABLED',
      message: 'CAPABILITY_DISABLED',
    });
  });

  it('logApiError never emits an empty payload for partial error objects', () => {
    logApiError({ requestId: 'req-orphan' }, { ticketId: 'WEB-1', operation: 'addComment' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[PMS]'),
      expect.objectContaining({
        message: expect.any(String),
        requestId: 'req-orphan',
        context: { ticketId: 'WEB-1', operation: 'addComment' },
      }),
    );

    const payload = console.error.mock.calls.at(-1)[1];
    expect(payload.message.length).toBeGreaterThan(0);
    expect(Object.values(payload).some((value) => value != null && value !== '')).toBe(true);
  });

  it('puts the diagnostic in the first console arg, where dev overlays can read it', () => {
    logApiError(
      { status: 409, code: 'STAGE_CONFLICT', message: 'Reload before transitioning.' },
      { ticketId: 'WEB-1', operation: 'transitionTicket' },
    );

    const [summary] = console.error.mock.calls.at(-1);
    expect(summary).toContain('409');
    expect(summary).toContain('STAGE_CONFLICT');
    expect(summary).toContain('Reload before transitioning.');
  });

  it('maps attachment capability errors to a readable message', () => {
    expect(attachmentErrorMessage({
      code: 'CAPABILITY_DISABLED',
      message: 'File attachments are not configured on this installation',
    })).toBe('File attachments are not configured on this installation');
  });
});
