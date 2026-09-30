export const FOCUS_TICKET_SEARCH_KEY = 'pms-focus-ticket-search';
export const TICKET_SEARCH_INPUT_ID = 'ticket-search-input';
export const TICKET_SEARCH_MOBILE_INPUT_ID = 'ticket-search-input-mobile';

// Both fields stay mounted and CSS shows one per breakpoint, so pick the one
// with a layout box: focusing a display:none input silently does nothing.
function visibleTicketSearchInput() {
  return [TICKET_SEARCH_INPUT_ID, TICKET_SEARCH_MOBILE_INPUT_ID]
    .map((id) => document.getElementById(id))
    .find((el) => el && el.getClientRects().length > 0) || null;
}

export function focusTicketSearch() {
  if (typeof document === 'undefined') return false;
  const input = visibleTicketSearchInput();
  if (!input) return false;
  input.focus({ preventScroll: true });
  input.scrollIntoView?.({ block: 'nearest' });
  input.select?.();
  return true;
}
