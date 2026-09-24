import { DEFAULT_TICKET_PREFERENCES } from '@pms/shared';

/**
 * The assistant changing the Tickets page's filters. It can't rebuild the URL:
 * a bare /tickets shows the user's saved filters, which it can't see, so "any
 * stage" would bring the saved "Pending" back. Instead the request is handed to
 * the page, which merges it into what is on screen and applies it like the
 * filter bar does. Queued, because the page may not be open yet.
 */
export const ASSISTANT_TICKET_FILTERS_EVENT = 'assistant:ticket-filters';

/**
 * The assistant working the By module view (collapse, expand, order, show more).
 * Handed over the same way, since the view may not be showing yet.
 */
export const ASSISTANT_MODULE_VIEW_EVENT = 'assistant:module-view';

/** The waiting request per event, kept until the page (or view) takes it. */
const queued = new Map();

function hand(event, request) {
  queued.set(event, request);
  window.dispatchEvent(new Event(event));
}

function take(event) {
  const request = queued.get(event) ?? null;
  queued.delete(event);
  return request;
}

/** Hands a filter change to the Tickets page (now, or when it next opens). */
export const requestTicketFilters = (action) => hand(ASSISTANT_TICKET_FILTERS_EVENT, action);

/** The waiting request, if any; taking it clears it. */
export const takeTicketFilters = () => take(ASSISTANT_TICKET_FILTERS_EVENT);

/** Hands module-view steps (in order) to the By module view. */
export const requestModuleView = (steps) => hand(ASSISTANT_MODULE_VIEW_EVENT, steps);

export const takeModuleView = () => take(ASSISTANT_MODULE_VIEW_EVENT);

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
