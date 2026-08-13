import { describe, it, expect } from 'vitest';
import {
  getTransitionFieldErrors,
  getValidationDialogForTransitionError,
  isTransitionValidationError,
} from '../api-error.js';

describe('api-error', () => {
  const ticket = {
    estimatedResolutionAt: null,
    expectedReleaseDate: null,
  };

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
    expect(isTransitionValidationError({ code: 'STAGE_CONFLICT' })).toBe(false);
  });
});
