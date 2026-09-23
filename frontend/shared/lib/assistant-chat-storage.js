/**
 * The assistant's conversation, kept per browser tab (sessionStorage) so a
 * reload doesn't lose it. Keyed by user id: after a sign-out, a different
 * sign-in, or impersonation in the same tab, one person's chat (which can hold
 * ticket details) must never load for another.
 */

const PREFIX = 'assistant.chat:';
const KEPT_MESSAGES = 40;

const keyFor = (userId) => `${PREFIX}${userId}`;

function storedKeys() {
  const keys = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(PREFIX) || key === 'assistant.chat') keys.push(key); // bare key: pre-per-user saves
  }
  return keys;
}

/** Removes every saved chat except `keepUserId`'s (all of them when omitted). */
export function clearAssistantChats(keepUserId) {
  try {
    const keep = keepUserId ? keyFor(keepUserId) : null;
    for (const key of storedKeys()) if (key !== keep) window.sessionStorage.removeItem(key);
  } catch { /* storage blocked: nothing was saved either */ }
}

export function readSavedChat(userId) {
  if (!userId) return [];
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(keyFor(userId)));
    if (!Array.isArray(saved)) return [];
    // A reload interrupts anything mid-flight; let the user try it again.
    return saved.map((message) => (message.actions
      ? { ...message, actions: message.actions.map((action) => (action.status === 'busy' ? { ...action, status: 'pending' } : action)) }
      : message));
  } catch {
    return [];
  }
}

export function saveChat(userId, messages) {
  if (!userId) return;
  try {
    if (!messages.length) {
      window.sessionStorage.removeItem(keyFor(userId));
      return;
    }
    // A picked logo file can't be stored; the user re-picks it after a reload.
    const kept = messages.slice(-KEPT_MESSAGES).map((message) => (message.actions
      ? { ...message, actions: message.actions.map(({ logoFile: _logoFile, ...action }) => action) }
      : message));
    window.sessionStorage.setItem(keyFor(userId), JSON.stringify(kept));
  } catch { /* storage full or blocked: the chat still works for this page */ }
}
