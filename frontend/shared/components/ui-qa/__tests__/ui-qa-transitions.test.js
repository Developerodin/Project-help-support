import { describe, it, expect } from 'vitest';
import {
  canTransitionQaStatus,
  legalQaDestinations,
  nextForwardQaStatus,
  nextQaStatusOptions,
} from '@pms/shared';

describe('ui-qa transitions', () => {
  it('advances review to in_progress, not review', () => {
    expect(nextForwardQaStatus('review')).toEqual({
      to: 'in_progress',
      label: 'In Progress',
    });
    expect(canTransitionQaStatus('review', 'review')).toBe(false);
  });

  it('does not offer review as a forward move from review', () => {
    expect(nextForwardQaStatus('review')?.to).not.toBe('review');
    expect(legalQaDestinations('review')).toEqual(
      expect.arrayContaining(['in_progress', 'open']),
    );
    expect(legalQaDestinations('review')).not.toContain('review');
  });

  it('offers no forward move from done (reopen is separate)', () => {
    expect(nextForwardQaStatus('done')).toBeNull();
    expect(nextQaStatusOptions('done')).toEqual(['open', 'review']);
  });
});
