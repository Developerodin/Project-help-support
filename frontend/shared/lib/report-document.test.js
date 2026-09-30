import { describe, expect, it } from 'vitest';
import { formatHours, reportFileName, reportHtml, reportPeriod } from './report-document.js';

const report = {
  project: { key: 'WEB', name: 'Web <App>' },
  from: '2026-09-16',
  to: '2026-09-23',
  totals: { tickets: 9, open: 6, created: 3, finished: 2, overdue: 17, blocked: 0 },
  by_stage: [{ stage: 'Pending', count: 4 }],
  bottleneck: { stage: 'In QA', median_hours: 76.8 },
  lead_time_median_hours: 30,
  cycle_time_median_hours: null,
  created_tickets: [],
  finished_tickets: [],
  overdue_tickets: [{ id: 'WEB-4', title: 'Inbox <script>', stage: 'Pending', priority: 'High', owner: 'Riya', due: '2026-09-20' }],
  blocked_tickets: [],
  open_by_owner: [{ name: 'Riya', open: 4 }],
};

describe('report document', () => {
  it('says hours as hours, and as days past two days', () => {
    expect(formatHours(30)).toBe('30 h');
    expect(formatHours(76.8)).toBe('3.2 days');
    expect(formatHours(null)).toBeNull();
  });

  it('names the period and the file after the project and dates', () => {
    expect(reportPeriod(report)).toBe('16 Sep – 23 Sep 2026');
    expect(reportFileName(report)).toBe('WEB-report-2026-09-16-to-2026-09-23.doc');
  });

  it('holds the summary, totals and lists, with text escaped and empty lists left out', () => {
    const html = reportHtml(report, 'Good week.\n**Two** tickets went live.');
    expect(html).toContain('<h1>Web &lt;App&gt; (WEB) report</h1>');
    expect(html).toContain('<p>Good week.</p><p>Two tickets went live.</p>');
    expect(html).toContain('<td>Inbox &lt;script&gt;</td>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Overdue (17)');
    expect(html).toContain('And 16 more.');
    expect(html).toContain('In QA (median 3.2 days)');
    expect(html).not.toContain('Cycle time');
    expect(html).not.toContain('Blocked (');
  });
});
