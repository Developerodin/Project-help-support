'use client';

import { QA_STATUS_LABELS } from '@pms/shared';
import UiQaStatusBadge from './ui-qa-status-badge.jsx';
import { countIndicators, levelLabel } from './ui-qa-utils.js';

function DetailField({ label, children, wide = false }) {
  return (
    <div className={`detail-field${wide ? ' wide' : ''}`}>
      <span className="lbl">{label}</span>
      <div className="v">{children}</div>
    </div>
  );
}

function EmptyValue({ children = 'Not set' }) {
  return <span className="empty">{children}</span>;
}

export default function UiQaDetailsTab({
  entity,
  data = {},
  breadcrumbs = [],
  meta,
  counts = {},
}) {
  const { comments, attachments } = countIndicators(data);
  const level = levelLabel(entity?.level);

  return (
    <>
      <h2 className="sr">Details</h2>
      <div className="detail-fields">
        <DetailField label="Name">
          {data.label || data.name || <EmptyValue>—</EmptyValue>}
        </DetailField>
        <DetailField label="Type">
          {level}
        </DetailField>
        <DetailField label="Status">
          <UiQaStatusBadge status={data.qaStatus || 'open'} />
        </DetailField>
        <DetailField label="Workflow">
          {QA_STATUS_LABELS[data.qaStatus || 'open'] || data.qaStatus}
        </DetailField>
        {entity?.level === 'module' && counts.pages != null ? (
          <DetailField label="Pages">{counts.pages}</DetailField>
        ) : null}
        {entity?.level === 'module' && counts.screens != null ? (
          <DetailField label="Screens">{counts.screens}</DetailField>
        ) : null}
        {entity?.level === 'page' && counts.screens != null ? (
          <DetailField label="Screens">{counts.screens}</DetailField>
        ) : null}
        {breadcrumbs.length > 0 ? (
          <DetailField label={entity?.level === 'module' ? 'Application' : 'Parent'}>
            {breadcrumbs.join(' → ')}
          </DetailField>
        ) : null}
        {meta ? (
          <DetailField label={entity?.level === 'screen' ? 'Route' : 'Path'}>
            <code className="detail-prose">{meta}</code>
          </DetailField>
        ) : null}
        {entity?.level === 'screen' && data.type ? (
          <DetailField label="Screen type">{data.type}</DetailField>
        ) : null}
        {entity?.level === 'screen' && data.status ? (
          <DetailField label="Catalog status">{data.status}</DetailField>
        ) : null}
        <DetailField label="Comments">{comments}</DetailField>
        <DetailField label="Attachments">{attachments}</DetailField>
        <DetailField label="Status history">
          {data.qaStatusHistory?.length || 0} change{(data.qaStatusHistory?.length || 0) === 1 ? '' : 's'}
        </DetailField>
        {data.documentation ? (
          <DetailField label="Documentation" wide>
            <p className="detail-prose">{data.documentation}</p>
          </DetailField>
        ) : null}
      </div>
    </>
  );
}
