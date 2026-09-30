import { describe, it, expect } from 'vitest';
import { buildActivityFeed } from '../ticket-activity.js';

const P = (name) => ({ name });

describe('buildActivityFeed', () => {
  it('returns an empty array for missing or empty sources', () => {
    expect(buildActivityFeed({})).toEqual([]);
    expect(buildActivityFeed({ activityLog: [], stageHistory: [], comments: [] })).toEqual([]);
  });

  it('orders newest first', () => {
    const feed = buildActivityFeed({
      activityLog: [
        { _id: 'a', action: 'created', performedBy: P('Root'), at: '2026-08-01T10:00:00.000Z' },
        { _id: 'b', action: 'blocked', performedBy: P('Root'), at: '2026-08-01T12:00:00.000Z' },
      ],
    });
    expect(feed.map((e) => e.at)).toEqual([
      '2026-08-01T12:00:00.000Z',
      '2026-08-01T10:00:00.000Z',
    ]);
  });

  it('normalizes offset-form timestamps so they order correctly against Z-form ones', () => {
    const feed = buildActivityFeed({
      activityLog: [
        { _id: 'a1', action: 'created', performedBy: P('Ann'), at: '2026-08-01T15:30:00+05:30' },
        { _id: 'a2', action: 'blocked', performedBy: P('Ann'), at: '2026-08-01T11:00:00.000Z' },
      ],
    });
    expect(feed.map((e) => e.kind)).toEqual(['block', 'created']);
    expect(feed[1].at).toBe('2026-08-01T10:00:00.000Z');
  });

  it('breaks timestamp ties by source priority: stage before activity before comment', () => {
    const at = '2026-08-01T10:00:00.000Z';
    const feed = buildActivityFeed({
      comments: [{ _id: 'c1', commentedBy: P('Ann'), createdAt: at, content: 'hi' }],
      activityLog: [{ _id: 'a1', action: 'blocked', performedBy: P('Ann'), at }],
      stageHistory: [{ _id: 's1', from: 'pending', to: 'under_review', by: P('Ann'), at }],
    });
    expect(feed.map((e) => e.kind)).toEqual(['stage', 'block', 'comment']);
  });

  it('drops activityLog transition twins so stage moves are not doubled', () => {
    const at = '2026-08-01T10:00:00.000Z';
    const feed = buildActivityFeed({
      activityLog: [{ _id: 'a1', action: 'transitioned', performedBy: P('Ann'), at }],
      stageHistory: [{ _id: 's1', from: 'pending', to: 'under_review', by: P('Ann'), at }],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('stage');
    expect(feed[0].summary).toBe('Moved Pending → Under Review');
  });

  it('renders a stageHistory entry with no from as a set', () => {
    const feed = buildActivityFeed({
      stageHistory: [{ _id: 's1', to: 'pending', by: P('Ann'), at: '2026-08-01T10:00:00.000Z' }],
    });
    expect(feed[0].summary).toBe('Set to Pending');
  });

  it('suppresses the from-less stage twin when activityLog already records creation', () => {
    const at = '2026-08-01T10:00:00.000Z';
    const feed = buildActivityFeed({
      activityLog: [{ _id: 'a1', action: 'created', performedBy: P('Ann'), at }],
      stageHistory: [{ _id: 's1', to: 'pending', by: P('Ann'), at }],
    });
    expect(feed.map((e) => e.summary)).toEqual(['Opened this ticket']);
  });

  it('groups multiple field changes from one save into one row', () => {
    const feed = buildActivityFeed({
      activityLog: [{
        _id: 'a1',
        action: 'updated',
        performedBy: P('Ann'),
        at: '2026-08-01T10:00:00.000Z',
        changes: [
          { field: 'priority', from: 'low', to: 'medium' },
          { field: 'environment', from: 'staging', to: 'production' },
          { field: 'severity', from: 'minor', to: 'major' },
        ],
      }],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('update');
    expect(feed[0].summary).toBe('Updated ticket · 3 changes');
    expect(feed[0].changes).toHaveLength(3);
    expect(feed[0].changes.map((c) => c.label)).toEqual(['Priority', 'Environment', 'Severity']);
  });

  it('filters no-op date changes after normalization', () => {
    const feed = buildActivityFeed({
      activityLog: [{
        _id: 'a1',
        action: 'updated',
        performedBy: P('Ann'),
        at: '2026-08-01T10:00:00.000Z',
        changes: [{ field: 'estimatedResolutionAt', from: '2026-08-19', to: '2026-08-19T00:00:00.000Z' }],
      }],
    });
    expect(feed).toEqual([]);
  });

  it('treats date-only and ISO midnight as equal without emitting a row', () => {
    const feed = buildActivityFeed({
      activityLog: [{
        _id: 'a1',
        action: 'updated',
        performedBy: P('Ann'),
        at: '2026-08-01T10:00:00.000Z',
        changes: [
          { field: 'expectedReleaseDate', from: '2026-08-20', to: '2026-08-20T00:00:00.000Z' },
          { field: 'priority', from: 'low', to: 'high' },
        ],
      }],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].changes).toHaveLength(1);
    expect(feed[0].changes[0].label).toBe('Priority');
  });

  it('keeps separate updated operations as separate rows', () => {
    const feed = buildActivityFeed({
      activityLog: [
        { _id: 'a1', action: 'updated', performedBy: P('Ann'), at: '2026-08-01T10:01:00.000Z', changes: [{ field: 'priority', from: 'low', to: 'high' }] },
        { _id: 'a2', action: 'updated', performedBy: P('Ann'), at: '2026-08-01T10:02:00.000Z', changes: [{ field: 'severity', from: 'minor', to: 'major' }] },
      ],
    });
    expect(feed).toHaveLength(2);
    expect(feed.every((e) => e.kind === 'update')).toBe(true);
  });

  it('includes a truncated comment preview', () => {
    const long = 'a'.repeat(150);
    const feed = buildActivityFeed({
      comments: [{ _id: 'c1', commentedBy: P('Ann'), createdAt: '2026-08-01T10:00:00.000Z', content: long }],
    });
    expect(feed[0].commentPreview).toHaveLength(101);
    expect(feed[0].commentPreview.endsWith('…')).toBe(true);
    expect(feed[0].href).toBe('discussion');
  });

  it('never renders a raw field key, an object, or an id', () => {
    const feed = buildActivityFeed({
      activityLog: [{
        _id: 'a1',
        action: 'assigned',
        performedBy: P('Ann'),
        at: '2026-08-01T10:00:00.000Z',
        changes: [{ field: 'assignedTo', from: { name: 'Old Owner' }, to: '64b2f8a1c3d4e5f6a7b8c9d0' }],
      }, {
        _id: 'a2',
        action: 'updated',
        performedBy: P('Ann'),
        at: '2026-08-01T09:00:00.000Z',
        changes: [{ field: 'sla_tier', from: 'x', to: 'y' }],
      }],
    });
    const text = JSON.stringify(feed);
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('64b2f8a1c3d4e5f6a7b8c9d0');
    expect(text).not.toContain('assignedTo');
    expect(text).not.toContain('sla_tier');
    expect(feed[0].summary).toBe('Changed the assignee');
    expect(feed[1]).toBeUndefined();
  });

  it('formats mapped date fields in the changes array', () => {
    const feed = buildActivityFeed({
      activityLog: [{
        _id: 'a1', action: 'updated', performedBy: P('Ann'), at: '2026-08-01T10:00:00.000Z',
        changes: [{ field: 'estimatedResolutionAt', from: '2026-08-20', to: '2026-08-24' }],
      }],
    });
    expect(feed[0].summary).toBe('Updated ticket');
    expect(feed[0].changes[0].label).toBe('Resolution estimate');
    expect(feed[0].changes[0].from).toBeTruthy();
    expect(feed[0].changes[0].to).toBeTruthy();
  });

  it('falls back safely for an unmapped action', () => {
    const feed = buildActivityFeed({
      activityLog: [{ _id: 'a1', action: 'sla_changed', performedBy: P('Ann'), at: '2026-08-01T10:00:00.000Z' }],
    });
    expect(feed[0].summary).toBe('Updated ticket');
    expect(feed[0].summary).not.toContain('undefined');
    expect(feed[0].summary).not.toContain('sla_changed');
  });

  it('tolerates malformed records without throwing', () => {
    const feed = buildActivityFeed({
      activityLog: [
        { _id: 'a1', action: 'assigned', performedBy: null, at: '2026-08-01T10:00:00.000Z', changes: null },
        { _id: 'a2', action: 'updated', performedBy: P('Ann'), at: null, changes: [{}] },
      ],
      stageHistory: [{ _id: 's1', to: 'pending', by: undefined, at: '2026-08-01T09:00:00.000Z' }],
      comments: [{ _id: 'c1', commentedBy: undefined, createdAt: '2026-08-01T08:00:00.000Z' }],
    });
    expect(feed.every((e) => typeof e.summary === 'string' && e.summary.length > 0)).toBe(true);
    expect(feed.map((e) => e.actor.name)).toEqual(['Someone', 'Someone', 'Someone']);
  });

  it('sorts events with no timestamp last', () => {
    const feed = buildActivityFeed({
      activityLog: [
        { _id: 'a1', action: 'blocked', performedBy: P('Ann'), at: null },
        { _id: 'a2', action: 'unblocked', performedBy: P('Ann'), at: '2026-08-01T10:00:00.000Z' },
      ],
    });
    expect(feed[feed.length - 1].at).toBe(null);
  });

  it('summarises file and block actions', () => {
    const feed = buildActivityFeed({
      activityLog: [
        { _id: 'a1', action: 'attachments_added', performedBy: P('Ann'), at: '2026-08-01T10:03:00.000Z', changes: [{ field: 'attachments', to: 'a.png' }, { field: 'attachments', to: 'b.png' }] },
        { _id: 'a2', action: 'attachment_removed', performedBy: P('Ann'), at: '2026-08-01T10:02:00.000Z', changes: [{ field: 'attachments', from: 'c.png' }] },
        { _id: 'a3', action: 'unblocked', performedBy: P('Ann'), at: '2026-08-01T10:01:00.000Z' },
      ],
    });
    expect(feed.map((e) => e.summary)).toEqual([
      'Attached 2 files',
      'Removed c.png',
      'Cleared the blocker',
    ]);
  });
});
