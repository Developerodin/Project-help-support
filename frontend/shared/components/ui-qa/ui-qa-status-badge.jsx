import { QA_STATUS_LABELS } from '@pms/shared';

const STATUS_CLASS = {
  open: 'ui-qa-status--open',
  review: 'ui-qa-status--review',
  in_progress: 'ui-qa-status--progress',
  done: 'ui-qa-status--done',
};

export default function UiQaStatusBadge({ status = 'open', className = '' }) {
  const label = QA_STATUS_LABELS[status] || status;
  const tone = STATUS_CLASS[status] || 'ui-qa-status--open';
  return <span className={`chip chip-sm ui-qa-status ${tone}${className ? ` ${className}` : ''}`}>{label}</span>;
}
