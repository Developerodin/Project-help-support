/**
 * @typedef {{ id: string, name: string, email?: string }} MentionPerson
 */

export function normalizeMentionPeople(mentions = []) {
  const people = [];
  for (const entry of mentions) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      people.push({ id: String(entry), name: 'Someone' });
      continue;
    }
    const id = entry.id ?? entry._id;
    if (!id) continue;
    people.push({
      id: String(id),
      name: entry.name || entry.email || 'Someone',
      email: entry.email,
    });
  }
  return people;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split comment text into plain spans and @mention spans using populated mention docs.
 */
export function segmentCommentMentions(content, mentions = []) {
  if (!content) return [];
  const people = normalizeMentionPeople(mentions)
    .filter((p) => p.name && p.name !== 'Someone')
    .sort((a, b) => b.name.length - a.name.length);
  if (!people.length) return [{ type: 'text', value: content }];

  const pattern = people
    .map((person) => `@${escapeRegExp(person.name)}`)
    .join('|');
  const re = new RegExp(`(${pattern})`, 'g');
  const segments = [];
  let lastIndex = 0;
  let match = re.exec(content);
  while (match) {
    const index = match.index;
    if (index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, index) });
    }
    const label = match[0];
    const person = people.find((p) => label === `@${p.name}`);
    if (person) {
      segments.push({ type: 'mention', value: label, person });
    } else {
      segments.push({ type: 'text', value: label });
    }
    lastIndex = index + label.length;
    match = re.exec(content);
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return segments.length ? segments : [{ type: 'text', value: content }];
}

export function filterMentionCandidates(candidates, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((person) => {
    const name = (person.name || '').toLowerCase();
    const email = (person.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });
}

export function insertMentionAt(text, start, end, name) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const token = `@${name} `;
  const next = `${before}${token}${after}`;
  const caret = before.length + token.length;
  return { next, caret };
}

export function mentionTriggerAt(text, caretIndex) {
  if (caretIndex <= 0) return null;
  const before = text.slice(0, caretIndex);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, end: caretIndex, query };
}

export function collectMentionIds(content, mentionMap) {
  const ids = new Set();
  for (const id of mentionMap.values()) ids.add(String(id));
  if (!content) return [...ids];
  for (const [name, id] of mentionMap.entries()) {
    if (content.includes(`@${name}`)) ids.add(String(id));
  }
  return [...ids];
}
