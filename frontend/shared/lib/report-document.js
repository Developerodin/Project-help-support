/**
 * A project report from the assistant as a document the user can download.
 *
 * ponytail: Word-compatible HTML saved as .doc, so no document library is
 * needed. Word, Google Docs and LibreOffice open it with its headings and
 * tables. If people need a true .docx (tracked changes, strict viewers), swap
 * this for the `docx` package; the report object stays the same.
 */

const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 30 → "30 h", 76 → "3.2 days"; null when there is nothing measured. */
export function formatHours(hours) {
  if (hours == null) return null;
  return hours > 48 ? `${(hours / 24).toFixed(1)} days` : `${Math.round(hours)} h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Sep – 23 Sep 2026". Fixed names, not the browser locale, so a shared document reads the same everywhere. */
export function reportPeriod(report) {
  const format = (value) => {
    const [, month, dayOfMonth] = value.split('-').map(Number);
    return `${dayOfMonth} ${MONTHS[month - 1]}`;
  };
  return `${format(report.from)} – ${format(report.to)} ${report.to.slice(0, 4)}`;
}

export const reportTitle = (report) => `${report.project.name} (${report.project.key}) report`;

export const REPORT_TOTALS = [
  ['open', 'Open'], ['created', 'New'], ['finished', 'Finished'], ['overdue', 'Overdue'], ['blocked', 'Blocked'],
];

/** The ticket lists, in the order they appear on the card and in the document. */
export const REPORT_LISTS = [
  { key: 'overdue_tickets', total: 'overdue', title: 'Overdue', extra: (t) => `Due ${t.due} · ${t.owner}` },
  { key: 'blocked_tickets', total: 'blocked', title: 'Blocked', extra: (t) => t.reason || 'No reason given' },
  { key: 'finished_tickets', total: 'finished', title: 'Finished in the period', extra: (t) => t.stage },
  { key: 'created_tickets', total: 'created', title: 'New in the period', extra: (t) => `${t.priority} · ${t.stage}` },
];

function table(headings, rows) {
  const head = headings.map((heading) => `<th>${escape(heading)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** The report as a standalone HTML document; `summary` is the assistant's written summary. */
export function reportHtml(report, summary = '') {
  const sections = [];
  sections.push(`<h1>${escape(reportTitle(report))}</h1>`);
  sections.push(`<p class="period">${escape(reportPeriod(report))}</p>`);
  if (summary.trim()) {
    sections.push('<h2>Summary</h2>');
    sections.push(summary.split('\n').filter((line) => line.trim())
      .map((line) => `<p>${escape(line.replace(/\*\*/g, ''))}</p>`).join(''));
  }
  sections.push('<h2>At a glance</h2>');
  sections.push(table(REPORT_TOTALS.map(([, label]) => label), [REPORT_TOTALS.map(([key]) => report.totals[key])]));
  const timing = [
    report.bottleneck && ['Slowest stage', `${report.bottleneck.stage} (median ${formatHours(report.bottleneck.median_hours)})`],
    report.lead_time_median_hours != null && ['Lead time, created to closed (median)', formatHours(report.lead_time_median_hours)],
    report.cycle_time_median_hours != null && ['Cycle time, started to live (median)', formatHours(report.cycle_time_median_hours)],
  ].filter(Boolean);
  if (timing.length) sections.push(table(['Measure', 'Value'], timing));
  if (report.by_stage.length) {
    sections.push('<h2>Tickets by stage</h2>');
    sections.push(table(['Stage', 'Tickets'], report.by_stage.map((row) => [row.stage, row.count])));
  }
  for (const list of REPORT_LISTS) {
    const items = report[list.key];
    if (!items.length) continue;
    const more = report.totals[list.total] - items.length;
    sections.push(`<h2>${escape(list.title)} (${report.totals[list.total]})</h2>`);
    sections.push(table(['Ticket', 'Title', 'Details'], items.map((ticket) => [ticket.id, ticket.title, list.extra(ticket)])));
    if (more > 0) sections.push(`<p class="note">And ${more} more.</p>`);
  }
  if (report.open_by_owner.length) {
    sections.push('<h2>Open tickets by owner</h2>');
    sections.push(table(['Owner', 'Open'], report.open_by_owner.map((row) => [row.name, row.open])));
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(reportTitle(report))}</title><style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2430}
h1{font-size:18pt;margin:0}h2{font-size:13pt;margin:18pt 0 6pt}
.period,.note{color:#5b6170}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #c9ccd4;padding:4pt 6pt;text-align:left;vertical-align:top}
th{background:#eef0f4}
</style></head><body>${sections.join('\n')}</body></html>`;
}

export const reportFileName = (report) => `${report.project.key}-report-${report.from}-to-${report.to}.doc`;

/** Saves the report as a document through the browser's download. */
export function downloadReport(report, summary) {
  const blob = new Blob([reportHtml(report, summary)], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFileName(report);
  link.click();
  URL.revokeObjectURL(url);
}
