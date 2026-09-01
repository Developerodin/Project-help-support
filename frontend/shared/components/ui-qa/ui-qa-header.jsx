'use client';

import Icon from '@/shared/components/icons.jsx';
import UiQaStatusBadge from './ui-qa-status-badge.jsx';
import { levelLabel } from './ui-qa-utils.js';

export default function UiQaHeader({
  title,
  entity,
  data,
  breadcrumbs = [],
  meta,
  onClose,
}) {
  const contextParts = [
    breadcrumbs.length ? breadcrumbs.join(' → ') : null,
    meta || null,
  ].filter(Boolean);

  return (
    <>
      <div className="drawer-id">
        <span className="id">{levelLabel(entity?.level)}</span>
        <UiQaStatusBadge status={data?.qaStatus || 'open'} />
        <span className="spacer" />
        <span className="acts">
          <button type="button" className="btn btn-ghost btn-sm btn-ico" onClick={onClose} aria-label="Close detail">
            <Icon name="x" size={13} />
          </button>
        </span>
      </div>
      <h2>{title}</h2>
      <div className="ctxstrip" role="group" aria-label="Entity context">
        <span className="ctxstrip__item ctxstrip__item--primary">
          {levelLabel(entity?.level)}
        </span>
        {contextParts.length > 0 ? (
          <span className="ctxstrip__item ctxstrip__item--secondary">
            {contextParts.join(' · ')}
          </span>
        ) : null}
      </div>
    </>
  );
}
