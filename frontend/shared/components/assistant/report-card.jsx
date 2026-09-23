'use client';

import Link from 'next/link';
import Icon from '../icons.jsx';
import {
  REPORT_LISTS, REPORT_TOTALS, formatHours, reportPeriod, reportTitle,
} from '@/shared/lib/report-document.js';

const ticketHref = (id) => `/tickets?ticket=${encodeURIComponent(id)}`;

/**
 * A project report in the chat: the totals up front, the ticket lists folded
 * away (native <details>, so they open by keyboard too), and a download.
 */
export default function ReportCard({ report, onDownload }) {
  const timing = [
    report.bottleneck && `Slowest stage: ${report.bottleneck.stage} (median ${formatHours(report.bottleneck.median_hours)})`,
    report.lead_time_median_hours != null && `Created to closed: ${formatHours(report.lead_time_median_hours)} median`,
  ].filter(Boolean);
  return (
    <section className="assistant-report" aria-label={reportTitle(report)}>
      <header className="assistant-report-head">
        <p className="assistant-report-title">{reportTitle(report)}</p>
        <p className="assistant-report-period">{reportPeriod(report)}</p>
      </header>
      <dl className="assistant-report-totals">
        {REPORT_TOTALS.map(([key, label]) => (
          <div key={key} className={(key === 'overdue' || key === 'blocked') && report.totals[key] ? 'is-alert' : undefined}>
            <dt>{label}</dt>
            <dd>{report.totals[key]}</dd>
          </div>
        ))}
      </dl>
      {timing.map((line) => <p key={line} className="assistant-report-note">{line}</p>)}
      {REPORT_LISTS.filter((list) => report[list.key].length).map((list) => (
        <details key={list.key} className="assistant-report-list">
          <summary>{list.title} <span>{report.totals[list.total]}</span></summary>
          <ul>
            {report[list.key].map((ticket) => (
              <li key={ticket.id}>
                <Link href={ticketHref(ticket.id)}>{ticket.id}</Link> {ticket.title}
                <span className="assistant-report-extra">{list.extra(ticket)}</span>
              </li>
            ))}
          </ul>
          {report.totals[list.total] > report[list.key].length ? (
            <p className="assistant-report-note">And {report.totals[list.total] - report[list.key].length} more.</p>
          ) : null}
        </details>
      ))}
      {report.open_by_owner.length ? (
        <details className="assistant-report-list">
          <summary>Open by owner</summary>
          <ul>
            {report.open_by_owner.map((row) => (
              <li key={row.name}>{row.name}<span className="assistant-report-extra">{row.open} open</span></li>
            ))}
          </ul>
        </details>
      ) : null}
      <button type="button" className="btn btn-sm assistant-report-download" onClick={onDownload}>
        <Icon name="download" size={14} aria-hidden="true" />
        Download document
      </button>
    </section>
  );
}
