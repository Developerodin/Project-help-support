import crypto from 'node:crypto';
import { can } from '@pms/shared';
import logger from '../../platform/logger.js';
import User from '../users/user.model.js';
import { loadPermissionContextForUser } from '../rbac/rbac.service.js';
import { chat } from '../assistant/assistant.service.js';
import { checkAllowance, recordUsage, withChatLock } from '../assistant/assistant.guard.js';
import { createTicket, resolveTicketDocForNotifications } from '../tickets/ticket.service.js';
import { createTicketSchema } from '../tickets/ticket.validation.js';
import { dispatchTicketEvent } from '../notifications/dispatch.js';
import { publishTicketUpdatedRealtime } from '../realtime/realtime.service.js';
import { WhatsappLink, WhatsappLinkCode, WhatsappState } from './whatsapp.model.js';

const MINUTE = 60 * 1000;
const CODE_TTL_MS = 10 * MINUTE;
/** Wrong codes one sender may try per hour; a code is 8 digits, so guessing is hopeless. */
const MAX_LINK_FAILURES = 5;
const HISTORY_MESSAGES = 20;
const HISTORY_TTL_MS = 30 * MINUTE;
/** Meta redelivers for up to 7 days. */
const SEEN_TTL_MS = 7 * 24 * 60 * MINUTE;
/** WhatsApp's limit for a text body. */
const MAX_BODY = 4096;
const GRAPH = 'https://graph.facebook.com/v26.0';

const LINK_MESSAGE = /^\s*link\s+(\d{8})\s*$/i;
// Answers to "Reply yes to create it or no to cancel" (English, Hindi, Hinglish).
const YES = /^\s*(yes|y|yeah|yep|ok|okay|confirm|create|create it|haan|han|ha|haa|हाँ|हां)\s*[.!]*\s*$/i;
const NO = /^\s*(no|n|nope|cancel|nahi|nahin|na|नहीं)\s*[.!]*\s*$/i;
const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');
const later = (ms) => new Date(Date.now() + ms);

export const REPLIES = {
  notLinked: 'This number isn\'t linked to a ProwPlus account. Open your profile in ProwPlus, choose "Link WhatsApp", and send the code it shows here.',
  badCode: 'That code is wrong or has expired. Get a new one from your profile in ProwPlus.',
  tooManyTries: 'Too many wrong codes. Try again in an hour.',
  inactive: 'Your ProwPlus account isn\'t active, so I can\'t answer here.',
  notAllowed: 'The assistant isn\'t enabled for your role.',
  disabled: 'The assistant isn\'t set up yet.',
  textOnly: 'I can only read text messages for now.',
  failed: 'That didn\'t work. Try again in a moment.',
};

/** A fresh code for the app to show; any earlier one for this user stops working. */
export async function startLink(user) {
  const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
  await WhatsappLinkCode.deleteMany({ user: user._id });
  await WhatsappLinkCode.create({ _id: hash(code), user: user._id, expiresAt: later(CODE_TTL_MS) });
  return { code, expiresAt: later(CODE_TTL_MS) };
}

export async function linkStatus(user) {
  const link = await WhatsappLink.findOne({ user: user._id }).lean();
  // Only the last digits: the app never needs to show the whole number back.
  return link ? { linked: true, number: `••••${link.waId.slice(-4)}`, linkedAt: link.linkedAt } : { linked: false };
}

export const unlink = (user) => WhatsappLink.deleteOne({ user: user._id });

async function tryLink(sender, code) {
  const fails = await WhatsappState.findById(`fail:${sender.waId}`).lean();
  if ((fails?.count ?? 0) >= MAX_LINK_FAILURES) return REPLIES.tooManyTries;

  // Deleting it is what makes the code single-use, even under a race.
  const pending = await WhatsappLinkCode.findOneAndDelete({ _id: hash(code), expiresAt: { $gt: new Date() } });
  if (!pending) {
    await WhatsappState.updateOne(
      { _id: `fail:${sender.waId}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: later(60 * MINUTE) } },
      { upsert: true },
    );
    return REPLIES.badCode;
  }
  const user = await User.findById(pending.user);
  if (!user || user.status !== 'active') return REPLIES.inactive;

  // One number per account and one account per number: this sender replaces both.
  await WhatsappLink.deleteMany({ $or: [{ user: user._id }, { waId: sender.waId }, ...(sender.bsuid ? [{ bsuid: sender.bsuid }] : [])] });
  await WhatsappLink.create({ user: user._id, waId: sender.waId, bsuid: sender.bsuid });
  logger.info('whatsapp linked', { userId: String(user._id) });
  return `Linked to ${user.name}. Ask me about your tickets and projects, or tell me about a new ticket to file.`;
}

async function findLink(sender) {
  const or = [{ waId: sender.waId }, ...(sender.bsuid ? [{ bsuid: sender.bsuid }] : [])];
  const link = await WhatsappLink.findOne({ $or: or });
  if (!link) return null;
  link.lastUsedAt = new Date();
  if (sender.bsuid && !link.bsuid) link.bsuid = sender.bsuid;
  await link.save();
  return link;
}

/**
 * The same checks as a signed-in request (platform/auth.js): the account is
 * re-read and must be active, and permissions come from the role matrix now,
 * not from when the number was linked. Tickets are then read through the
 * assistant's tools, which apply the app's own access rules for this user.
 */
async function ask(config, link, text) {
  const user = await User.findById(link.user);
  if (!user || user.status !== 'active') return REPLIES.inactive;
  if (!config.assistant) return REPLIES.disabled;
  const permissionContext = await loadPermissionContextForUser(user._id);
  if (!can(user, 'assistant.use', permissionContext)) return REPLIES.notAllowed;

  const key = `chat:${user._id}`;
  const state = await WhatsappState.findById(key).lean();
  const messages = [...(state?.messages ?? []), { role: 'user', content: text.slice(0, 4000) }];
  // draft: undefined keeps the waiting draft, null drops it, a body replaces it.
  const save = (reply, note, draft) => WhatsappState.updateOne(
    { _id: key },
    {
      $set: {
        messages: [...messages, { role: 'assistant', content: note ? `${reply}

${note}` : reply }].slice(-HISTORY_MESSAGES),
        expiresAt: later(HISTORY_TTL_MS),
        ...(draft ? { draft } : {}),
      },
      ...(draft === null ? { $unset: { draft: 1 } } : {}),
    },
    { upsert: true },
  );

  if (state?.draft && (YES.test(text) || NO.test(text))) {
    // Taking the draft out atomically is what stops a double "yes" filing it twice.
    const claimed = await WhatsappState.findOneAndUpdate(
      { _id: key, draft: { $exists: true } },
      { $unset: { draft: 1 } },
    ).lean();
    if (claimed?.draft) {
      const reply = YES.test(text) ? await fileTicket(config, user, permissionContext, claimed.draft) : 'Cancelled. Nothing was created.';
      await save(reply, null, null);
      return reply;
    }
  }

  try {
    const turn = await withChatLock(user, async () => {
      await checkAllowance(config, user);
      const result = await chat(config, user, permissionContext, messages, { mode: 'whatsapp' });
      await recordUsage(config, user, result.usage);
      return result;
    });
    const drafted = turn.actions.filter((action) => action.type === 'create_ticket').at(-1);
    // The model sees its draft on later turns the same way the app shows it one ([Draft …] notes).
    const note = drafted
      ? `[Draft "New ticket in ${drafted.projectKey}": ${draftSummary(drafted.body)}. Status: waiting for the user to reply yes or no]`
      : null;
    await save(turn.reply, note, drafted?.body);
    return turn.reply;
  } catch (err) {
    // Budget spent, or still answering the last one: ApiError messages are written for the user.
    if (err?.isOperational) return err.message;
    throw err;
  }
}

function draftSummary(body) {
  return ['title', 'module', 'page', 'category', 'severity', 'priority', 'environment', 'description']
    .filter((field) => body[field])
    .map((field) => `${field}: ${String(body[field]).slice(0, 300)}`)
    .join('; ');
}

/**
 * What confirming the card does in the app (POST /tickets): the same validation,
 * and createTicket re-checks this user's permission and project access.
 */
async function fileTicket(config, user, permissionContext, draft) {
  const { value, error } = createTicketSchema.body.validate(draft);
  if (error) return `I couldn't create it: ${error.message}`;
  let ticket;
  try {
    ticket = await createTicket(user, value, permissionContext);
  } catch (err) {
    if (err?.isOperational) return `I couldn't create it: ${err.message}`;
    throw err;
  }
  logger.info('whatsapp ticket created', { userId: String(user._id), ticketId: ticket.ticketId });
  // As in the controller: a notification failure must not read as "not filed".
  try {
    const doc = await resolveTicketDocForNotifications(ticket.id);
    await dispatchTicketEvent({ event: { type: 'TICKET_CREATED' }, ticket: doc, actor: user, config });
    publishTicketUpdatedRealtime(doc, user);
  } catch (err) {
    logger.error('whatsapp ticket notify failed', { ticketId: ticket.ticketId, error: err.message });
  }
  return `Created *${ticket.ticketId}*: ${ticket.title}`;
}

/**
 * The model sometimes writes markdown; WhatsApp has its own marks
 * (*bold*, _italic_) and shows the rest as literal symbols.
 */
export function toWhatsapp(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/^(\s*)[*•]\s+/gm, '$1- ')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1: $2');
}

/** What to reply to one incoming message, or null when it was already answered. */
export async function answer(config, sender, message) {
  try {
    await WhatsappState.create({ _id: `seen:${message.id}`, expiresAt: later(SEEN_TTL_MS) });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
  if (message.type !== 'text') return (await findLink(sender)) ? REPLIES.textOnly : REPLIES.notLinked;

  const text = message.text?.body ?? '';
  const linkCode = LINK_MESSAGE.exec(text)?.[1];
  if (linkCode) return tryLink(sender, linkCode);

  const link = await findLink(sender);
  if (!link) return REPLIES.notLinked;
  return ask(config, link, text);
}

export async function send(config, to, body) {
  const res = await fetch(`${GRAPH}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'text', text: { body: toWhatsapp(body).slice(0, MAX_BODY) },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) logger.error('whatsapp send failed', { status: res.status, body: (await res.text()).slice(0, 500) });
}

/** The business number people message, for the app's "open WhatsApp" link. Cached; null if Meta can't be reached. */
let businessNumber;
export async function getBusinessNumber(config) {
  if (businessNumber) return businessNumber;
  try {
    const res = await fetch(`${GRAPH}/${config.whatsapp.phoneNumberId}?fields=display_phone_number`, {
      headers: { Authorization: `Bearer ${config.whatsapp.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    businessNumber = (await res.json()).display_phone_number?.replace(/\D/g, '') || null;
    return businessNumber;
  } catch {
    return null;
  }
}
