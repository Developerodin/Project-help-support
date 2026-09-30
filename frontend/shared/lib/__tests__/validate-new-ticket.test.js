import { describe, it, expect } from 'vitest';
import { validateNewTicketDraft } from '../validate-new-ticket.js';

describe('validateNewTicketDraft', () => {
  it('flags missing project, title, and description', () => {
    const result = validateNewTicketDraft({ project: '', title: '', description: '' });
    expect(result.valid).toBe(false);
    expect(result.summaryItems).toEqual([
      'Project',
      'Title (min 5 characters)',
      'Description (min 10 characters)',
    ]);
    expect(result.firstFieldId).toBe('np');
  });

  it('accepts valid draft', () => {
    const result = validateNewTicketDraft({
      project: 'p1',
      title: 'Valid title',
      description: 'Long enough description',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
