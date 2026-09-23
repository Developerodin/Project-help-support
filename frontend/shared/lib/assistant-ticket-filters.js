import { DEFAULT_TICKET_PREFERENCES } from '@pms/shared';

/**
 * The assistant changing the Tickets page's filters. It can't rebuild the URL:
 * a bare /tickets shows the user's saved filters, which it can't see, so "any
 * stage" would bring the saved "Pending" back. Instead the request is handed to
 * the page, which merges it into what is on screen and applies it like the
 * filter bar does. Queued, because the page may not be open yet.
 */
export const ASSISTANT_TICKET_FILTERS_EVENT = 'assistant:ticket-filters';

let queued = null;

/** Hands a filter change to the Tickets page (now, or when it next opens). */
export function requestTicketFilters(action) {
  queued = action;
  window.dispatchEvent(new Event(ASSISTANT_TICKET_FILTERS_EVENT));
}

/** The waiting request, if any; taking it clears it. */
export function takeTicketFilters() {
  const action = queued;
  queued = null;
  return action;
}

/**
 * The filters to show: the ones on screen (or none, for clear_all) with the
 * requested changes on top. An owner named by the assistant is matched against
 * the page's owner list; one that isn't there leaves the owner filter alone.
 */
export function nextTicketFilters(current, action, ownerOptions = []) {
  const next = { ...(action.reset ? DEFAULT_TICKET_PREFERENCES.filters : current), ...action.filters };
  if (action.ownerName) {
    const wanted = action.ownerName.toLowerCase();
    const match = ownerOptions.find((owner) => owner.name?.toLowerCase() === wanted)
      || ownerOptions.find((owner) => owner.name?.toLowerCase().includes(wanted));
    if (match) next.assignedTo = match.id;
  }
  return next;
}
