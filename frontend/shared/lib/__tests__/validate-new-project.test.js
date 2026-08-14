import { describe, it, expect } from 'vitest';
import { validateNewProjectDraft } from '../validate-new-project.js';

describe('validateNewProjectDraft', () => {
  it('requires brand and project name only', () => {
    const result = validateNewProjectDraft({ brand: '', name: '', description: '' });
    expect(result.valid).toBe(false);
    expect(result.summaryItems).toEqual(['Brand', 'Project']);
  });

  it('accepts a draft without a ticket key', () => {
    const result = validateNewProjectDraft({ brand: 'Acme', name: 'Operations', description: '' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
