import { describe, expect, it } from 'vitest';
import {
  collectMentionIds,
  mentionTriggerAt,
  segmentCommentMentions,
} from '../mention-text.js';

describe('mentionTriggerAt', () => {
  it('detects @query at end of composer text', () => {
    const text = 'Hi @ja';
    expect(mentionTriggerAt(text, text.length)).toEqual({
      start: 3,
      end: 6,
      query: 'ja',
    });
  });

  it('ignores @ inside words', () => {
    expect(mentionTriggerAt('email@host.com', 15)).toBeNull();
  });
});

describe('segmentCommentMentions', () => {
  it('highlights populated mention names', () => {
    const segments = segmentCommentMentions('Hey @Jane Doe — check this', [
      { id: '1', name: 'Jane Doe' },
    ]);
    expect(segments).toEqual([
      { type: 'text', value: 'Hey ' },
      { type: 'mention', value: '@Jane Doe', person: { id: '1', name: 'Jane Doe' } },
      { type: 'text', value: ' — check this' },
    ]);
  });
});

describe('collectMentionIds', () => {
  it('returns ids referenced in content', () => {
    const map = new Map([['Jane Doe', 'abc']]);
    expect(collectMentionIds('Ping @Jane Doe', map)).toEqual(['abc']);
  });
});
