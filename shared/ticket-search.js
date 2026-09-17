/** Matches backend list validation (`ticket.validation.js`). */
export const TICKET_SEARCH_MAX_LENGTH = 200;

const ID_SHAPE = /^([a-z]{2,10})?[\s\-\u2010-\u2015]*(\d{1,7})$/i;
const MAX_WORDS = 6;
const MIN_WORD_LENGTH = 2;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Same semantics as the list API search: number/title/module only.
 * Returns a Mongo filter fragment, or null when the term would not narrow results.
 */
export function ticketSearchClause(raw) {
  const term = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!term) return null;

  const id = term.match(ID_SHAPE);
  if (id) {
    const key = id[1] ? `^${escapeRegex(id[1])}-` : '^[A-Za-z0-9]+-';
    return { ticketId: { $regex: `${key}${id[2]}$`, $options: 'i' } };
  }

  const words = term
    .split(' ')
    .filter((word) => word.length >= MIN_WORD_LENGTH && /[a-z0-9]/i.test(word))
    .slice(0, MAX_WORDS)
    .map(escapeRegex);
  if (!words.length) return null;

  return {
    $and: words.map((word) => ({
      $or: [
        { title: { $regex: word, $options: 'i' } },
        { module: { $regex: word, $options: 'i' } },
        { ticketId: { $regex: word, $options: 'i' } },
      ],
    })),
  };
}

/** True when a non-empty typed value would be sent as `q` but ignored by the API. */
export function ticketSearchTermIsNoOp(raw) {
  const term = String(raw ?? '').trim();
  if (!term) return false;
  return ticketSearchClause(term) === null;
}
