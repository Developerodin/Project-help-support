import { describe, it, expect } from 'vitest';
import { validateNewProjectDraft } from '../validate-new-project.js';

describe('validateNewProjectDraft', () => {
  it('requires company and project name', () => {
    const result = validateNewProjectDraft({ clientId: '', name: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.field)).toEqual(['clientId', 'name']);
    expect(result.firstFieldId).toBe('npc');
  });

  it('passes when company and project name are present', () => {
    const result = validateNewProjectDraft({ clientId: 'c1', name: 'Web App' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
