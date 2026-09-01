export function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function commentAuthorId(comment) {
  const by = comment?.commentedBy;
  if (!by) return null;
  if (typeof by === 'string') return by;
  return String(by._id || by.id || '');
}

export function isOwnComment(comment, user) {
  const authorId = commentAuthorId(comment);
  const userId = String(user?._id || user?.id || '');
  return Boolean(authorId && userId && authorId === userId);
}

export function commentRecordId(comment) {
  return comment?._id || comment?.id || null;
}

export function countIndicators(entity) {
  const comments = entity?.comments?.length || 0;
  const attachments = (entity?.attachments?.length || 0)
    + (entity?.comments || []).reduce((sum, row) => sum + (row.attachments?.length || 0), 0);
  return { comments, attachments };
}

export function findEntityData(modules, entity) {
  const mod = modules.find((row) => row.key === entity.moduleKey);
  if (!mod) return null;
  if (entity.level === 'module') return mod;
  const page = (mod.pages || []).find((row) => row.key === entity.pageKey);
  if (!page) return null;
  if (entity.level === 'page') return page;
  return (page.screens || []).find((row) => row.key === entity.screenKey) || null;
}

export function sameEntity(a, b) {
  if (!a || !b) return false;
  return a.level === b.level
    && a.moduleKey === b.moduleKey
    && (a.pageKey || '') === (b.pageKey || '')
    && (a.screenKey || '') === (b.screenKey || '');
}

export function levelLabel(level) {
  if (level === 'module') return 'Module';
  if (level === 'page') return 'Page';
  if (level === 'screen') return 'Screen';
  return level;
}
