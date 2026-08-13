export const TICKET_PARAM = 'ticket';

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
