/**
 * The assistant's conversation, kept per browser tab (sessionStorage) so a
 * reload doesn't lose it. Keyed by user id: after a sign-out, a different
 * sign-in, or impersonation in the same tab, one person's chat (which can hold
 * ticket details) must never load for another.
 */

const PREFIX = 'assistant.chat:';
const KEPT_MESSAGES = 40;
/** Earlier chats set aside by New chat, newest first, kept like the current one. */
const RECENT_PREFIX = 'assistant.recent:';
const KEPT_CHATS = 5;

const keyFor = (userId) => `${PREFIX}${userId}`;
const recentKeyFor = (userId) => `${RECENT_PREFIX}${userId}`;

function storedKeys() {
  const keys = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(PREFIX) || key?.startsWith(RECENT_PREFIX) || key === 'assistant.chat') keys.push(key); // bare key: pre-per-user saves
  }
  return keys;
}

/** Removes every saved chat except `keepUserId`'s (all of them when omitted). */
export function clearAssistantChats(keepUserId) {
  try {
    const keep = keepUserId ? [keyFor(keepUserId), recentKeyFor(keepUserId)] : [];
    for (const key of storedKeys()) if (!keep.includes(key)) window.sessionStorage.removeItem(key);
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
    window.sessionStorage.setItem(keyFor(userId), JSON.stringify(storable(messages)));
  } catch { /* storage full or blocked: the chat still works for this page */ }
}

/** A chat as stored: the newest messages, without a picked logo file (it can't be stored). */
const storable = (messages) => messages.slice(-KEPT_MESSAGES).map((message) => (message.actions
  ? { ...message, actions: message.actions.map(({ logoFile: _logoFile, ...action }) => action) }
  : message));

/** This user's earlier chats in this tab, newest first: { id, title, at, messages }. */
export function readRecentChats(userId) {
  if (!userId) return [];
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(recentKeyFor(userId)));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function writeRecentChats(userId, chats) {
  try {
    if (chats.length) window.sessionStorage.setItem(recentKeyFor(userId), JSON.stringify(chats));
    else window.sessionStorage.removeItem(recentKeyFor(userId));
  } catch { /* storage full or blocked: the list just isn't kept */ }
}

/**
 * Sets a chat aside (New chat, or opening an earlier one), titled by its first
 * question. Drafts still waiting are marked cancelled: by the time the chat is
 * reopened they may be out of date, and nothing is applied without a fresh ask.
 */
export function archiveChat(userId, messages, now = new Date()) {
  const first = messages.find((message) => message.role === 'user' && message.content);
  if (!userId || !first) return;
  const settled = messages.map((message) => (message.actions?.some((action) => action.status === 'pending')
    ? { ...message, actions: message.actions.map((action) => (action.status === 'pending' ? { ...action, status: 'dismissed' } : action)) }
    : message));
  const chat = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    title: first.content.replace(/\s+/g, ' ').trim().slice(0, 60),
    at: now.toISOString(),
    messages: storable(settled),
  };
  writeRecentChats(userId, [chat, ...readRecentChats(userId)].slice(0, KEPT_CHATS));
}

/** Takes an earlier chat out of the list to reopen it; null if it is gone. */
export function takeRecentChat(userId, id) {
  const chats = readRecentChats(userId);
  const chat = chats.find((entry) => entry.id === id) ?? null;
  if (chat) writeRecentChats(userId, chats.filter((entry) => entry !== chat));
  return chat;
}
