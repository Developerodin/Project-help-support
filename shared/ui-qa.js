import { QA_STATUSES, QA_STATUS_LABELS } from './enums.js';

/** Allowed QA status transitions (including reopen from done). */
export const QA_STATUS_TRANSITIONS = Object.freeze({
  open: ['review'],
  review: ['in_progress', 'open'],
  in_progress: ['done', 'review'],
  done: ['open', 'review'],
});

/** @param {string} from @param {string} to */
export function canTransitionQaStatus(from, to) {
  if (!QA_STATUSES.includes(from) || !QA_STATUSES.includes(to)) return false;
  return (QA_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** @param {string} status */
export function nextQaStatusOptions(status) {
  if (!QA_STATUSES.includes(status)) return [...QA_STATUSES];
  return QA_STATUS_TRANSITIONS[status] || [];
}

/** @param {string} status */
export function qaStatusIndex(status) {
  const index = QA_STATUSES.indexOf(status);
  return index === -1 ? 0 : index;
}

/** Next pipeline-forward status, or null when only backward/reopen moves remain. */
export function nextForwardQaStatus(status) {
  if (!QA_STATUSES.includes(status)) return null;
  const currentIndex = qaStatusIndex(status);
  for (let i = currentIndex + 1; i < QA_STATUSES.length; i += 1) {
    const key = QA_STATUSES[i];
    if (canTransitionQaStatus(status, key)) {
      return { to: key, label: QA_STATUS_LABELS[key] };
    }
  }
  return null;
}

/** Clickable stage-rail destinations (excludes current status). */
export function legalQaDestinations(status) {
  if (!QA_STATUSES.includes(status)) return [];
  return QA_STATUSES.filter((key) => key !== status && canTransitionQaStatus(status, key));
}

/** @param {string} status */
export function isQaReopen(from, to) {
  return from === 'done' && (to === 'open' || to === 'review');
}

/** @typedef {'module' | 'page' | 'screen'} UiQaLevel */

/** @param {{ level: UiQaLevel, moduleKey: string, pageKey?: string, screenKey?: string }} entity */
export function uiQaEntityPath(entity) {
  const parts = [entity.moduleKey];
  if (entity.level === 'page' || entity.level === 'screen') {
    if (!entity.pageKey) return null;
    parts.push(entity.pageKey);
  }
  if (entity.level === 'screen') {
    if (!entity.screenKey) return null;
    parts.push(entity.screenKey);
  }
  return parts.join('/');
}
