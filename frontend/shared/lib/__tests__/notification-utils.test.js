import { describe, expect, it } from 'vitest';
import {
  groupNotificationsByTicket,
  groupsByDay,
  notificationChipLabel,
  notificationDayLabel,
  notificationEventChipClass,
  notificationGroupHref,
  notificationHref,
  notificationActivityAt,
  notificationPrimaryLine,
  notificationTicketObjectId,
  notificationTicketKey,
  notificationUpdateCount,
  notificationUpdateDescription,
  sumNotificationUpdates,
  ticketSubjectFromGroup,
  truncateNotificationText,
  visibleUpdates,
} from '../notification-utils.js';

describe('notification-utils', () => {
  it('derives ticket key from link', () => {
    expect(notificationTicketKey({
      link: 'http://localhost:3000/tickets?ticket=ELE2-20&project=abc',
    })).toBe('ELE2-20');
  });

  it('labels the chip from event, and drops it when the title already says it', () => {
    expect(notificationChipLabel({ title: 'Asha commented on WEB-1', event: 'TICKET_COMMENTED' }))
      .toBe('New comment');
    expect(notificationChipLabel({ title: 'WEB-1 · Assigned', event: 'TICKET_ASSIGNED' })).toBeNull();
    expect(notificationChipLabel({ title: 'Anything', event: undefined })).toBeNull();
  });

  it('reads the ticket ObjectId from the populated ticket', () => {
    expect(notificationTicketObjectId({ ticket: { id: 'abc', ticketId: 'WEB-1' } })).toBe('abc');
    expect(notificationTicketObjectId({ ticket: 'def' })).toBe('def');
    expect(notificationTicketObjectId({})).toBeNull();
  });

  it('keeps path, query and hash of links from any host', () => {
    expect(notificationHref('https://old.example/tickets?ticket=WEB-1&comment=c1#comment-c1'))
      .toBe('/tickets?ticket=WEB-1&comment=c1#comment-c1');
    expect(notificationHref('/tickets?ticket=WEB-1')).toBe('/tickets?ticket=WEB-1');
    expect(notificationHref('')).toBe('/notifications');
  });

  it('omits description when body repeats ticket subject', () => {
    expect(notificationUpdateDescription({
      body: 'Web App',
      ticket: { title: 'Web App' },
      event: 'TICKET_COMMENTED',
    })).toBeNull();

    expect(notificationUpdateDescription({
      body: 'Pending → In progress',
      ticket: { title: 'Web App' },
      event: 'TICKET_STAGE_CHANGED',
    })).toBe('Pending → In progress');
  });

  it('uses the title as written, else ticket key and event label', () => {
    expect(notificationPrimaryLine({
      title: 'Asha moved WEB-1 to In progress',
      event: 'TICKET_STAGE_CHANGED',
    })).toBe('Asha moved WEB-1 to In progress');

    expect(notificationPrimaryLine({
      event: 'TICKET_ASSIGNED',
      link: '/tickets?ticket=WEB-2',
    })).toBe('WEB-2 · Assigned');
  });

  it('labels days relative to now and groups consecutive cards by day', () => {
    const now = new Date(2026, 8, 25, 15, 0);
    expect(notificationDayLabel(new Date(2026, 8, 25, 1, 0).toISOString(), now)).toBe('Today');
    expect(notificationDayLabel(new Date(2026, 8, 24, 23, 0).toISOString(), now)).toBe('Yesterday');

    const at = (d) => ({ latest: { createdAt: new Date(2026, 8, d, 10).toISOString() } });
    const days = groupsByDay([at(25), at(25), at(24), at(20)], now);
    expect(days.map((day) => day.groups.length)).toEqual([2, 1, 1]);
    expect(days[0].label).toBe('Today');
  });

  it('files a merged row under the day of its latest update', () => {
    const now = new Date(2026, 8, 25, 15, 0);
    const days = groupsByDay([{
      latest: {
        createdAt: new Date(2026, 8, 20, 10).toISOString(),
        activityAt: new Date(2026, 8, 25, 9).toISOString(),
      },
    }], now);
    expect(days[0].label).toBe('Today');
  });

  it('reads activityAt and count, with fallbacks for older rows', () => {
    expect(notificationActivityAt({ createdAt: 'c', activityAt: 'a' })).toBe('a');
    expect(notificationActivityAt({ createdAt: 'c' })).toBe('c');
    expect(notificationUpdateCount({ count: 4 })).toBe(4);
    expect(notificationUpdateCount({})).toBe(1);
    expect(notificationUpdateCount({ count: 0 })).toBe(1);
    expect(sumNotificationUpdates([{ count: 3 }, {}, { count: 2 }])).toBe(6);
  });

  it('maps event chip classes', () => {
    expect(notificationEventChipClass('TICKET_MENTIONED')).toBe('notif-chip--sig');
    expect(notificationEventChipClass('TICKET_ESTIMATE_SET')).toBe('notif-chip--warn');
  });

  it('groups inbox items by ticket on the current page, newest activity first', () => {
    const groups = groupNotificationsByTicket([
      { id: '1', link: '/tickets?ticket=A-1', createdAt: '2026-01-02T00:00:00Z' },
      { id: '2', link: '/tickets?ticket=A-1', createdAt: '2026-01-01T00:00:00Z', activityAt: '2026-01-03T00:00:00Z' },
      { id: '3', link: '/tickets?ticket=B-2', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].ticketKey).toBe('A-1');
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].latest.id).toBe('2');
  });

  it('truncates long subject fallback text', () => {
    const long = 'a'.repeat(130);
    expect(truncateNotificationText(long, 120)).toHaveLength(120);
    expect(truncateNotificationText(long, 120).endsWith('…')).toBe(true);
  });

  it('resolves ticket subject from populated ticket or body', () => {
    expect(ticketSubjectFromGroup({
      items: [{ body: 'Body', ticket: { title: 'Electrician Visit' } }],
    })).toBe('Electrician Visit');

    expect(ticketSubjectFromGroup({
      items: [{ body: '  First body  ' }],
    })).toBe('First body');

    expect(ticketSubjectFromGroup({ items: [{ title: 'X' }] })).toBeNull();
  });

  it('limits visible updates until expanded', () => {
    const items = [1, 2, 3, 4, 5].map((n) => ({ id: n }));
    const collapsed = visibleUpdates(items, false);
    expect(collapsed.visible).toHaveLength(3);
    expect(collapsed.hiddenCount).toBe(2);
    expect(visibleUpdates(items, true).visible).toHaveLength(5);
  });

  it('builds group href from latest notification link', () => {
    expect(notificationGroupHref({
      latest: { link: 'https://app.example/tickets?ticket=WEB-1' },
    })).toBe('/tickets?ticket=WEB-1');
  });
});
