export const FOCUS_TICKET_SEARCH_KEY = 'pms-focus-ticket-search';
export const TICKET_SEARCH_INPUT_ID = 'ticket-search-input';

export function focusTicketSearch() {
  if (typeof document === 'undefined') return false;
  const input = document.getElementById(TICKET_SEARCH_INPUT_ID);
  if (!input) return false;
  input.focus();
  input.select?.();
  return true;
}
