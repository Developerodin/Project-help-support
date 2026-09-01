export const TICKET_PARAM = 'ticket';
export const UI_QA_PARAM = 'uiQa';

export function ticketFromSearch(search) {
  return new URLSearchParams(search).get(TICKET_PARAM);
}

export function withTicketParam(search, ticketId) {
  const params = new URLSearchParams(search);
  params.set(TICKET_PARAM, ticketId);
  return `?${params.toString()}`;
}

export function withoutTicketParam(search) {
  const params = new URLSearchParams(search);
  params.delete(TICKET_PARAM);
  const rest = params.toString();
  // An empty string rather than "?" — a bare question mark is still a URL
  // change, which is exactly what closing a drawer should not produce.
  return rest ? `?${rest}` : '';
}

/** @param {{ level: string, moduleKey: string, pageKey?: string, screenKey?: string }} entity */
export function uiQaEntityToParam(entity) {
  if (!entity?.level || !entity?.moduleKey) return null;
  const parts = [entity.level, entity.moduleKey];
  if (entity.pageKey) parts.push(entity.pageKey);
  if (entity.screenKey) parts.push(entity.screenKey);
  return parts.join(':');
}

export function uiQaEntityFromParam(value) {
  if (!value) return null;
  const [level, moduleKey, pageKey, screenKey] = value.split(':');
  if (!level || !moduleKey) return null;
  if (!['module', 'page', 'screen'].includes(level)) return null;
  const entity = { level, moduleKey };
  if (level === 'page' || level === 'screen') {
    if (!pageKey) return null;
    entity.pageKey = pageKey;
  }
  if (level === 'screen') {
    if (!screenKey) return null;
    entity.screenKey = screenKey;
  }
  return entity;
}

export function uiQaEntityFromSearch(search) {
  return uiQaEntityFromParam(new URLSearchParams(search).get(UI_QA_PARAM));
}

export function withUiQaParam(search, entity) {
  const param = uiQaEntityToParam(entity);
  const params = new URLSearchParams(search);
  if (param) params.set(UI_QA_PARAM, param);
  else params.delete(UI_QA_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

export function withoutUiQaParam(search) {
  const params = new URLSearchParams(search);
  params.delete(UI_QA_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
