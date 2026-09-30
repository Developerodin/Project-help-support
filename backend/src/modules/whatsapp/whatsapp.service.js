import crypto from 'node:crypto';
import path from 'node:path';
import { can, isExternalUser } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';
import { assertStorageEnabled } from '../../platform/s3.js';
import { ALLOWED_TYPES, MAX_FILE_BYTES, sniffType } from '../../platform/upload.js';
import User from '../users/user.model.js';
import { loadPermissionContextForUser } from '../rbac/rbac.service.js';
import { recordRbacAudit } from '../rbac/rbac-audit.js';
import { chat } from '../assistant/assistant.service.js';
import {
  checkAllowance, estimateAudioSeconds, recordUsage, withChatLock,
} from '../assistant/assistant.guard.js';
import { isAudio } from '../assistant/assistant.route.js';
import { projectRoster } from '../assistant/assistant.tools.js';
import { transcribe } from '../assistant/openai.client.js';
import { createTicket, resolveTicketDocForNotifications } from '../tickets/ticket.service.js';
import { createTicketSchema } from '../tickets/ticket.validation.js';
import { addAttachments } from '../tickets/attachment.service.js';
import { dispatchTicketEvent } from '../notifications/dispatch.js';
import { publishTicketUpdatedRealtime } from '../realtime/realtime.service.js';
import { WhatsappLink, WhatsappLinkCode, WhatsappState } from './whatsapp.model.js';

const MINUTE = 60 * 1000;
const MB = 1024 * 1024;
const CODE_TTL_MS = 10 * MINUTE;
/** Wrong codes one sender may try per hour; a code is 8 digits, so guessing is hopeless. */
const MAX_LINK_FAILURES = 5;
const HISTORY_MESSAGES = 20;
const HISTORY_TTL_MS = 30 * MINUTE;
/** Meta redelivers for up to 7 days. */
const SEEN_TTL_MS = 7 * 24 * 60 * MINUTE;
/** One audit row per unlinked number a day: enough to see a stranger, not a record of what they sent. */
const STRANGER_TTL_MS = 24 * 60 * MINUTE;
/** WhatsApp's limit for a text body. */
const MAX_BODY = 4096;
/** Files one draft carries, as the app's upload takes at most 10 at a time. */
const MAX_FILES = 10;
/** The transcriber's own cap in the app (assistant.route.js). */
const MAX_AUDIO_BYTES = 5 * MB;
/** Meta shows "typing…" for up to 25 seconds; sent again before then while the answer is still coming. */
const TYPING_REFRESH_MS = 20_000;
/**
 * How long a message waits for the one before it to be answered. People on WhatsApp
 * write in bubbles and nobody is watching a spinner, so it is longer than in the app.
 */
const LOCK_WAIT_MS = 2 * MINUTE;
/** Bytes read to check a file's type when it arrives; the whole file is read and checked at yes. */
const HEAD_BYTES = 64 * 1024;
const GRAPH = 'https://graph.facebook.com/v26.0';

const LINK_MESSAGE = /^\s*link\s+(\d{8})\s*$/i;
// Answers to a confirmation (English, Hindi, Hinglish). With files named, "no" skips just
// those files and "cancel" drops the whole pending action; with none, both cancel.
const YES = /^\s*(yes|y|yeah|yep|ok|okay|confirm|create|create it|attach|attach it|haan|han|ha|haa|हाँ|हां)\s*[.!]*\s*$/i;
const NO = /^\s*(no|n|nope|skip|skip it|nahi|nahin|na|नहीं)\s*[.!]*\s*$/i;
const CANCEL = /^\s*(cancel|cancel it|radd|रद्द)\s*[.!]*\s*$/i;
/** Message types that carry a file for a ticket. Voice ("audio") is transcribed instead. */
const FILE_TYPES = new Set(['image', 'document', 'video']);
const EXT_FOR_MIME = Object.fromEntries(ALLOWED_TYPES.map((type) => [type.mime, type.exts[0]]));
const AUDIO_EXT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'webm' };
const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');
const later = (ms) => new Date(Date.now() + ms);

export const REPLIES = {
  notLinked: 'This number isn\'t linked to a ProwPlus account. Open your profile in ProwPlus, choose "Link WhatsApp", and send the code it shows here.',
  badCode: 'That code is wrong or has expired. Get a new one from your profile in ProwPlus.',
  tooManyTries: 'Too many wrong codes. Try again in an hour.',
  inactive: 'Your ProwPlus account isn\'t active, so I can\'t answer here.',
  notAllowed: 'The assistant isn\'t enabled for your role.',
  disabled: 'The assistant isn\'t set up yet.',
  unsupported: 'I can read text, voice notes, photos, videos and documents. Send one of those.',
  tooManyFiles: `That's ${MAX_FILES} files already. Answer the question about them first, or reply *cancel* to drop them.`,
  unheard: 'I couldn\'t make out that voice note. Try again, or type it.',
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

/** From the profile page. `auditContext` carries the request (and any impersonator) into the audit log. */
export async function unlink(user, auditContext = {}) {
  const link = await WhatsappLink.findOneAndDelete({ user: user._id }).lean();
  if (link) {
    await recordRbacAudit(user, 'whatsapp.unlinked', {
      userId: String(user._id), waId: link.waId, reason: 'profile',
    }, auditContext);
  }
}

async function tryLink(sender, code, messageId) {
  const fails = await WhatsappState.findById(`fail:${sender.waId}`).lean();
  if ((fails?.count ?? 0) >= MAX_LINK_FAILURES) return REPLIES.tooManyTries;

  // Deleting it is what makes the code single-use, even under a race.
  const pending = await WhatsappLinkCode.findOneAndDelete({ _id: hash(code), expiresAt: { $gt: new Date() } });
  if (!pending) {
    const now = await WhatsappState.findOneAndUpdate(
      { _id: `fail:${sender.waId}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: later(60 * MINUTE) } },
      { upsert: true, new: true },
    ).lean();
    // Once, as the block starts; the tries it then refuses are not logged one by one.
    if (now.count === MAX_LINK_FAILURES) {
      const owner = await WhatsappLink.findOne({ waId: sender.waId }).lean();
      await recordRbacAudit(null, 'whatsapp.link_blocked', {
        waId: sender.waId, messageId, attempts: now.count, ...(owner ? { userId: String(owner.user) } : {}),
      });
    }
    return REPLIES.badCode;
  }
  const user = await User.findById(pending.user);
  if (!user || user.status !== 'active') return REPLIES.inactive;

  // One number per account and one account per number: this sender replaces both.
  const or = [{ user: user._id }, { waId: sender.waId }, ...(sender.bsuid ? [{ bsuid: sender.bsuid }] : [])];
  const replaced = await WhatsappLink.find({ $or: or }).lean();
  await WhatsappLink.deleteMany({ $or: or });
  await WhatsappLink.create({ user: user._id, waId: sender.waId, bsuid: sender.bsuid });
  for (const old of replaced) {
    if (String(old.user) === String(user._id) && old.waId === sender.waId) continue;
    // The account's old number, or this number taken from another account.
    await recordRbacAudit(user, 'whatsapp.unlinked', {
      userId: String(old.user), waId: old.waId, messageId, reason: 'replaced',
    });
  }
  await recordRbacAudit(user, 'whatsapp.linked', { userId: String(user._id), waId: sender.waId, messageId });
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

/** An unlinked number wrote to us: noted once a day, without what it said. */
async function noteStranger(sender, message) {
  try {
    await WhatsappState.create({ _id: `stranger:${sender.waId}`, expiresAt: later(STRANGER_TTL_MS) });
  } catch (err) {
    if (err?.code === 11000) return;
    throw err;
  }
  await recordRbacAudit(null, 'whatsapp.unknown_sender', { waId: sender.waId, messageId: message.id, type: message.type });
}

/**
 * The same checks as a signed-in request (platform/auth.js): the account is
 * re-read and must be active, and permissions come from the role matrix now,
 * not from when the number was linked. Tickets are then read through the
 * assistant's tools, which apply the app's own access rules for this user.
 */
async function open(config, link, storage) {
  const user = await User.findById(link.user);
  if (!user || user.status !== 'active') return REPLIES.inactive;
  if (!config.assistant) return REPLIES.disabled;
  const permissionContext = await loadPermissionContextForUser(user._id);
  if (!can(user, 'assistant.use', permissionContext)) return REPLIES.notAllowed;
  return {
    link, user, permissionContext, key: `chat:${user._id}`, storage,
  };
}

/**
 * Stores one exchange. In `change`, undefined keeps a field, null drops it and
 * a value replaces it (draft, attach).
 */
function saveTurn(key, said, reply, note = null, change = {}) {
  const set = {};
  const unset = {};
  for (const [field, value] of Object.entries(change)) {
    if (value === null) unset[field] = 1;
    else if (value !== undefined) set[field] = value;
  }
  const messages = [
    { role: 'user', content: said.slice(0, 4000) },
    { role: 'assistant', content: note ? `${reply}\n\n${note}` : reply },
  ];
  // Appended, not rewritten: a file noted while the model was answering is kept.
  return WhatsappState.updateOne(
    { _id: key },
    {
      $push: { messages: { $each: messages, $slice: -HISTORY_MESSAGES } },
      $set: { expiresAt: later(HISTORY_TTL_MS), ...set },
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
    { upsert: true },
  );
}

/** Audit rows for what this message did: who (the actor), from which number and message. */
function auditor(session, messageId, base = {}) {
  return (action, details = {}) => recordRbacAudit(session.user, `whatsapp.${action}`, {
    waId: session.link.waId, messageId, ...base, ...details,
  });
}

/** Names and titles go into a question on one line, so none can pose as a line of the question. */
const oneLine = (value) => String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').trim();
const namesOf = (files) => files.map((file) => file.name);
const fileNames = (files) => files.map((file) => `*${file.name}*`).join(', ');
const theFiles = (files) => (files.length === 1 ? 'the file' : 'the files');
const idsOf = (files) => files.map((file) => file.messageId);
/** The files the last question named: a yes or no covers these and no others. */
const namedIn = (state) => (state?.files ?? []).filter((file) => (state?.asked ?? []).includes(file.messageId));

function attachPrompt(attach, files) {
  const where = `*${attach.ticketId}*${attach.title ? `: ${oneLine(attach.title).slice(0, 120)}` : ''}`;
  if (!files.length) return `Send the file here and I'll ask before adding it to ${where}. Reply *cancel* to stop.`;
  return `Attach ${fileNames(files)} to ${where}? Reply *yes* to attach, *no* to skip ${theFiles(files)}, or *cancel*.`;
}

function draftPrompt(draft, files) {
  const title = draft.title ? ` "${oneLine(draft.title).slice(0, 120)}"` : '';
  if (!files.length) return `Create the ticket${title}? Reply *yes* to create it, or *no* to cancel.`;
  return `Create the ticket${title} with ${fileNames(files)} attached? `
    + `Reply *yes* to create it with ${theFiles(files)}, *no* to skip ${theFiles(files)}, or *cancel*.`;
}

/** The question waiting on the user, naming every file held now. */
const promptFor = (state) => (state.draft
  ? draftPrompt(state.draft, state.files ?? [])
  : attachPrompt(state.attach, state.files ?? []));

/** Marks the files a question just named, and when, or clears the mark when it named none. */
const asking = (files) => (files.length ? { asked: idsOf(files), askedAt: new Date() } : { asked: null, askedAt: null });

/** The waiting question, asked again with every file held now. */
const askAgain = (state) => ({ reply: promptFor(state), change: asking(state.files ?? []) });

/**
 * Whether a reply was typed before the question now waiting was asked, so it answers an
 * earlier one. Meta's timestamp is whole seconds (its clock, ours for askedAt): only a
 * second that ended before the question counts, so a prompt answer is never refused.
 */
function sentBefore(sentAt, askedAt) {
  const at = Number(sentAt);
  return at > 0 && Boolean(askedAt) && (at + 1) * 1000 <= new Date(askedAt).getTime();
}

function choiceIn(text) {
  if (YES.test(text)) return 'yes';
  if (NO.test(text)) return 'no';
  if (CANCEL.test(text)) return 'cancel';
  return null;
}

/** The model's own "reply yes…" line, dropped where the question that follows is ours. */
const withoutYesLine = (reply) => reply.replace(/^.*\breply\b.*\byes\b.*$/gim, '').trim();

/**
 * One typed (or heard) message. The whole turn holds the user's chat lock and reads the
 * chat inside it, so bubbles sent in a row are answered one at a time, each seeing the last.
 * ponytail: the lock is polled, not a queue, so two bubbles waiting at once may be answered
 * out of order; queue per user by Meta's timestamp if that shows up.
 */
async function ask(config, session, text, messageId, sentAt) {
  try {
    return await withChatLock(session.user, () => askLocked(config, session, text, messageId, sentAt), { waitMs: LOCK_WAIT_MS });
  } catch (err) {
    // Budget spent, or still answering after the wait: ApiError messages are written for the user.
    if (err?.isOperational) return err.message;
    throw err;
  }
}

async function askLocked(config, session, text, messageId, sentAt) {
  const { user, permissionContext, key } = session;
  const state = await WhatsappState.findById(key).lean();
  const history = state?.messages ?? [];
  const files = state?.files ?? [];

  const choice = choiceIn(text);
  if (choice && (state?.draft || state?.attach)) {
    const decided = await decide(config, session, state, choice, messageId, sentAt);
    if (decided) {
      await saveTurn(key, text, decided.reply, decided.note ?? null, decided.change);
      return decided.reply;
    }
  } else if (choice === 'cancel' && files.length) {
    // Files held with nothing asked about yet ("What is it for?"): dropped, never fetched again.
    await WhatsappState.updateOne({ _id: key }, { $pull: { files: { messageId: { $in: idsOf(files) } } }, $unset: { asked: 1, askedAt: 1 } });
    const reply = `Dropped ${fileNames(files)}. Nothing was attached.`;
    await saveTurn(key, text, reply);
    return reply;
  }

  // The same note the app adds for files staged with the paperclip.
  const staged = files.length ? `\n[Files ready to attach: ${namesOf(files).join(', ')}]` : '';
  const messages = [...history, { role: 'user', content: `${text.slice(0, 4000)}${staged}` }];
  await checkAllowance(config, user);
  const turn = await chat(config, user, permissionContext, messages, { mode: 'whatsapp' });
  await recordUsage(config, user, turn.usage);
  const drafted = turn.actions.filter((action) => action.type === 'create_ticket' || action.type === 'attach_files').at(-1);
  if (drafted?.type === 'attach_files') {
    // The confirmation is ours, not the model's: it names exactly the files and ticket a yes will use.
    const attach = { ticketId: drafted.ticketId, projectKey: drafted.projectKey, title: drafted.title };
    const reply = attachPrompt(attach, files);
    const note = `[Draft "Attach files to ${attach.ticketId}". Status: waiting for the user to `
      + `${files.length ? 'reply yes, no or cancel' : 'send the file'}]`;
    await saveTurn(key, text, reply, note, { attach, draft: null, ...asking(files) });
    return reply;
  }
  if (!drafted) {
    // A draft, or files, still wait on a yes: the reply ends with that question, so a yes
    // ("ok" to something else the model asked, say) answers only what the user can see.
    const now = await WhatsappState.findById(key).lean();
    if (now?.draft || (now?.attach && now.files?.length)) {
      const modelText = withoutYesLine(turn.reply);
      const reply = modelText ? `${modelText}\n\n${promptFor(now)}` : promptFor(now);
      await saveTurn(key, text, reply, null, asking(now.files ?? []));
      return reply;
    }
    await saveTurn(key, text, turn.reply);
    return turn.reply;
  }
  let reply = turn.reply;
  if (files.length) {
    // With files, the question is ours too, so it names every file a yes would attach.
    const modelText = withoutYesLine(turn.reply);
    const question = `${draftPrompt(drafted.body, files)} Or tell me what to change.`;
    reply = modelText ? `${modelText}\n\n${question}` : question;
  }
  // The model sees its draft on later turns the same way the app shows it one ([Draft …] notes).
  const details = [draftSummary(drafted.body)];
  if (drafted.guessed?.length) details.push(`Guessed: ${drafted.guessed.join(', ')}`);
  if (files.length) details.push(`Files: ${namesOf(files).join(', ')}`);
  details.push(`Status: waiting for the user to reply ${files.length ? 'yes, no or cancel' : 'yes or no'}`);
  const note = `[Draft "New ticket in ${drafted.projectKey}": ${details.join('. ')}]`;
  await saveTurn(key, text, reply, note, { draft: drafted.body, attach: null, ...asking(files) });
  return reply;
}

function draftSummary(body) {
  return ['title', 'module', 'page', 'category', 'severity', 'priority', 'environment', 'description']
    .filter((field) => body[field])
    .map((field) => `${field}: ${String(body[field]).slice(0, 300)}`)
    .join('; ');
}

/**
 * A file from WhatsApp, fetched with the business token: Meta first gives a
 * short-lived URL for the media id, then the bytes. Limits are checked before
 * and after the download, since the size Meta reports is not the bytes it sends.
 * With `headBytes`, only that much is read (enough to check the type) and the size is Meta's.
 */
async function fetchMedia(config, mediaId, maxBytes, { label = 'It', headBytes } = {}) {
  const unavailable = () => new ApiError(502, 'WHATSAPP_MEDIA_UNAVAILABLE', `${label} couldn't be fetched from WhatsApp. Send it again.`);
  const tooBig = () => new ApiError(413, 'FILE_TOO_LARGE', `${label} is over ${maxBytes / MB} MB, the limit here.`);
  const headers = { Authorization: `Bearer ${config.whatsapp.token}` };
  try {
    const meta = await fetch(`${GRAPH}/${encodeURIComponent(String(mediaId))}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!meta.ok) throw unavailable();
    const info = await meta.json();
    if (Number(info.file_size) > maxBytes) throw tooBig();
    if (!String(info.url ?? '').startsWith('https://')) throw unavailable();
    const res = await fetch(info.url, { headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw unavailable();
    if (Number(res.headers.get('content-length')) > maxBytes) throw tooBig();
    const mimeType = String(info.mime_type ?? '').split(';')[0].trim().toLowerCase();
    if (headBytes) return { buffer: await readHead(res, headBytes), mimeType, size: Number(info.file_size) || 0 };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw tooBig();
    return { buffer, mimeType, size: buffer.length };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn('whatsapp media fetch failed', { error: err.message });
    throw unavailable();
  }
}

/**
 * The first `bytes` of a download, then the rest is dropped unread. A cut can split a
 * UTF-8 character, so a cut head ends at its last ASCII byte and a text file still reads as text.
 */
async function readHead(res, bytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  let done = false;
  while (got < bytes && !done) {
    const next = await reader.read();
    done = next.done;
    if (next.value) {
      chunks.push(next.value);
      got += next.value.length;
    }
  }
  if (!done) await reader.cancel();
  const head = Buffer.concat(chunks);
  if (head.length <= bytes && done) return head;
  const cut = head.subarray(0, bytes);
  return cut.subarray(0, cut.findLastIndex((b) => b < 0x80) + 1);
}

/** Documents keep their own name; photos and videos get one, as WhatsApp sends none. */
function mediaName(message, media, mimeType) {
  if (media.filename) return oneLine(path.basename(String(media.filename))).slice(0, 200);
  // A 3GP video from an older phone, say: the app's uploads don't take it either.
  if (!EXT_FOR_MIME[mimeType]) throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', `Files of type ${mimeType || 'unknown'} are not allowed.`);
  const at = new Date(Number(message.timestamp) * 1000 || Date.now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const kind = message.type === 'image' ? 'photo' : message.type;
  return `whatsapp-${kind}-${at}.${EXT_FOR_MIME[mimeType]}`;
}

/**
 * The upload route's type check. A type the app never takes is refused as such,
 * not as a mismatch: a .3gp shares MP4's signature, so it would read as one.
 */
function checkType(buffer, name) {
  try {
    sniffType(buffer, name);
  } catch (err) {
    const ext = path.extname(name).slice(1).toLowerCase();
    if (err?.code === 'MIME_EXTENSION_MISMATCH' && !ALLOWED_TYPES.some((type) => type.exts.includes(ext))) {
      throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', `".${ext}" files are not allowed.`);
    }
    throw err;
  }
}

/**
 * Fetches the files again at "yes" and checks them as the upload route does.
 * All of them, before anything is written: a file that fails leaves no ticket behind.
 */
async function downloadFiles(config, files) {
  if (!files.length) return [];
  assertStorageEnabled(config);
  const uploads = [];
  // Sequential: up to 10 files of up to 25MB each, held in memory.
  for (const file of files) {
    const { buffer } = await fetchMedia(config, file.mediaId, MAX_FILE_BYTES, { label: file.name });
    checkType(buffer, file.name);
    uploads.push({ buffer, originalname: file.name, size: buffer.length });
  }
  return uploads;
}

/** The paperclip upload's own path. The first file's message id makes a redelivered yes a no-op. */
function storeFiles(config, session, ticketId, files, uploads) {
  return addAttachments(session.user, ticketId, uploads, config, {
    clientRef: `whatsapp:${files[0].messageId}`,
    permissionContext: session.permissionContext,
    storage: session.storage,
    via: 'whatsapp',
  });
}

/**
 * A photo, video or document. Checked now (type from its first bytes, size as Meta
 * reports it) so a bad file is refused at once, then only its media id is kept: the
 * whole file is fetched, checked again, and stored only after the user replies yes.
 */
async function receiveFile(config, session, message) {
  const media = message[message.type] ?? {};
  const { key } = session;
  const state = await WhatsappState.findById(key).lean();
  if ((state?.files?.length ?? 0) >= MAX_FILES) return REPLIES.tooManyFiles;
  let file;
  try {
    assertStorageEnabled(config);
    const { buffer, mimeType, size } = await fetchMedia(config, media.id, MAX_FILE_BYTES, { headBytes: HEAD_BYTES });
    const name = mediaName(message, media, mimeType);
    checkType(buffer, name);
    file = {
      messageId: message.id, mediaId: String(media.id), name, size,
    };
  } catch (err) {
    if (err?.isOperational) return `I can't attach that file. ${err.message}`;
    throw err;
  }
  const now = await WhatsappState.findOneAndUpdate(
    { _id: key },
    { $push: { files: { $each: [file], $slice: -MAX_FILES } }, $set: { expiresAt: later(HISTORY_TTL_MS) } },
    { upsert: true, new: true },
  ).lean();

  const caption = String(media.caption ?? '').trim();
  if (caption) return ask(config, session, caption, message.id, message.timestamp);

  const sent = `[Sent a file: ${file.name}]`;
  // Waiting on a question already: asked again, naming this file with the others, so a yes covers what it says.
  if (now.draft || now.attach) {
    const reply = `Got *${file.name}*. ${promptFor(now)}`;
    await saveTurn(key, sent, reply, null, asking(now.files));
    return reply;
  }
  const reply = `Got *${file.name}*. What is it for? Describe the problem to file a new ticket with it, `
    + 'or tell me the ticket to add it to, like "add this to WEB-12". Reply *cancel* to drop it.';
  await saveTurn(key, sent, reply);
  return reply;
}

/**
 * A voice note becomes the words in it, then goes on as if typed. The audio is
 * held in memory only for the transcriber; it is never stored.
 */
async function listen(config, session, message) {
  const { user, permissionContext } = session;
  let text;
  try {
    const { buffer, mimeType } = await fetchMedia(config, message.audio?.id, MAX_AUDIO_BYTES, { label: 'That voice note' });
    if (!isAudio(buffer)) return 'That doesn\'t sound like a voice note. Send it again, or type your message.';
    await checkAllowance(config, user);
    // The user's project keys and names help the transcriber spell them right.
    const vocabulary = await projectRoster({ user, permissionContext, projects: null });
    const audio = { buffer, mimetype: mimeType || 'audio/ogg', originalname: `voice.${AUDIO_EXT[mimeType] ?? 'ogg'}` };
    const result = await transcribe(config, audio, { vocabulary });
    await recordUsage(config, user, { transcribeSeconds: estimateAudioSeconds(buffer.length, Infinity) * result.attempts });
    text = result.text;
  } catch (err) {
    if (err?.isOperational) return err.message;
    throw err;
  }
  if (!text) return REPLIES.unheard;
  return ask(config, session, text, message.id, message.timestamp);
}

/**
 * A yes, no or cancel to the waiting question, or null when there is none left
 * to answer (a double reply), which then goes to the model as before.
 *   yes     does it, with the files the question named; files that came after are asked about next.
 *   no      skips the named files (never fetched or stored) and keeps the draft or ticket waiting.
 *   cancel  drops the draft or ticket and every file held for it.
 */
async function decide(config, session, state, said, messageId, sentAt) {
  const { key } = session;
  const pending = state.draft ? 'draft' : 'attach';
  const named = idsOf(namedIn(state));
  // Nothing named yet: a yes gets the question, now naming every file; a no has nothing to skip.
  const yesToNoFiles = said === 'yes' && pending === 'attach' && !named.length;
  // Typed before this question: it answered an earlier one, which may have named fewer files.
  const answeredEarlier = said !== 'cancel' && named.length > 0 && sentBefore(sentAt, state.askedAt);
  if (yesToNoFiles || answeredEarlier) return askAgain(state);
  const choice = said === 'no' && !named.length ? 'cancel' : said;

  // Atomic, and only if no file was named since the read: a double reply acts once,
  // and a yes never covers a file that arrived after the question the user answered.
  let update;
  if (choice === 'cancel') {
    update = { $unset: { [pending]: 1, files: 1, asked: 1, askedAt: 1 } };
  } else {
    const unset = choice === 'yes' ? { [pending]: 1, asked: 1, askedAt: 1 } : { asked: 1, askedAt: 1 };
    update = { $pull: { files: { messageId: { $in: named } } }, $unset: unset };
  }
  const claimed = await WhatsappState.findOneAndUpdate(
    { _id: key, [pending]: { $exists: true }, asked: state.asked ?? { $exists: false } },
    update,
  ).lean();
  if (!claimed) {
    const now = await WhatsappState.findById(key).lean();
    if (!now?.draft && !now?.attach) return null;
    return askAgain(now);
  }

  const files = namedIn(claimed);
  // How the draft ended, in the history as the app notes it, so the model doesn't take the
  // "waiting" note from when it drafted as still true.
  const heading = pending === 'draft' ? 'New ticket' : `Attach files to ${claimed.attach.ticketId}`;
  const settled = (status) => `[Draft "${heading}". Status: ${status}]`;
  const audit = auditor(session, messageId, pending === 'draft' ? { title: claimed.draft.title } : { ticketId: claimed.attach.ticketId });
  if (choice === 'cancel') {
    const dropped = namesOf(claimed.files ?? []);
    if (pending === 'draft') {
      await audit('ticket_cancelled', dropped.length ? { files: dropped } : {});
      return { reply: 'Cancelled. Nothing was created.', note: settled('cancelled by the user, nothing was created') };
    }
    await audit('attach_cancelled', { files: dropped });
    return { reply: 'Cancelled. Nothing was attached.', note: settled('cancelled by the user, nothing was attached') };
  }
  if (choice === 'no') {
    await audit('attach_skipped', { files: namesOf(files) });
    const skipped = `Skipped ${fileNames(files)}. Nothing was attached.`;
    const now = await WhatsappState.findById(key).lean();
    if (!now?.[pending]) return { reply: skipped };
    return { reply: `${skipped}\n\n${promptFor(now)}`, change: asking(now.files ?? []) };
  }

  const done = pending === 'draft'
    ? await fileTicket(config, session, claimed.draft, files, audit)
    : await attachFiles(config, session, claimed.attach, files, audit);
  const note = settled(done.status);
  if (!done.attach) return { reply: done.reply, note };
  // Files that came in after the question stay held, and are asked about now, for the same ticket.
  const now = await WhatsappState.findById(key).lean();
  if (!now?.files?.length || now.draft || now.attach) return { reply: done.reply, note };
  return {
    reply: `${done.reply}\n\n${attachPrompt(done.attach, now.files)}`,
    note,
    change: { attach: done.attach, ...asking(now.files) },
  };
}

/**
 * What confirming the card does in the app (POST /tickets): the same validation,
 * and createTicket re-checks this user's permission and project access. Files
 * then go through the app's upload path, which checks ticket access again.
 */
async function fileTicket(config, session, draft, files, audit) {
  const { user, permissionContext } = session;
  const failed = async (detail) => {
    await audit('ticket_failed', { reason: detail });
    return { reply: `I couldn't create it: ${detail}`, status: `failed (${detail}), nothing was created` };
  };
  const { value, error } = createTicketSchema.body.validate(draft);
  if (error) return failed(error.message);
  let ticket;
  let uploads;
  try {
    uploads = await downloadFiles(config, files);
    ticket = await createTicket(user, value, permissionContext, { via: 'whatsapp' });
  } catch (err) {
    if (err?.isOperational) return failed(err.message);
    throw err;
  }

  // The ticket exists now: a file that won't store must not read as "not filed", or a retry files it twice.
  let attachError = null;
  if (uploads.length) {
    try {
      await storeFiles(config, session, ticket.ticketId, files, uploads);
    } catch (err) {
      logger.error('whatsapp ticket files failed', { ticketId: ticket.ticketId, error: err.message });
      attachError = err?.isOperational ? err.message : 'the file store didn\'t respond';
    }
  }
  const attached = uploads.length && !attachError ? namesOf(files) : [];
  await audit('ticket_created', { ticketId: ticket.ticketId, ...(attached.length ? { files: attached } : {}) });
  if (attachError) {
    await audit('attach_failed', { ticketId: ticket.ticketId, files: namesOf(files), reason: attachError });
  }
  logger.info('whatsapp ticket created', { userId: String(user._id), ticketId: ticket.ticketId, files: attached.length });
  // As in the controller: a notification failure must not read as "not filed".
  try {
    const doc = await resolveTicketDocForNotifications(ticket.id);
    await dispatchTicketEvent({ event: { type: 'TICKET_CREATED' }, ticket: doc, actor: user, config });
    publishTicketUpdatedRealtime(doc, user);
  } catch (err) {
    logger.error('whatsapp ticket notify failed', { ticketId: ticket.ticketId, error: err.message });
  }
  const created = `Created *${ticket.ticketId}*: ${ticket.title}`;
  const status = `confirmed and applied, created ${ticket.ticketId}`;
  if (attachError) {
    return {
      reply: `${created}. I couldn't attach ${fileNames(files)} (${attachError}); add them in the app.`,
      status: `${status}; ${namesOf(files).join(', ')} not attached (${attachError})`,
    };
  }
  return {
    reply: attached.length ? `${created}, with ${fileNames(files)} attached.` : created,
    status: attached.length ? `${status} with ${attached.join(', ')} attached` : status,
    attach: { ticketId: ticket.ticketId, title: ticket.title },
  };
}

/**
 * Files for a ticket that exists: the paperclip route's checks (ticket access,
 * or a client's own scope), then its upload path, which checks the ticket again.
 */
async function attachFiles(config, session, attach, files, baseAudit) {
  const { user, permissionContext } = session;
  const audit = (action, details = {}) => baseAudit(action, { files: namesOf(files), ...details });
  const failed = async (detail) => {
    await audit('attach_failed', { reason: detail });
    return { reply: `I couldn't attach it: ${detail}`, status: `failed (${detail}), nothing was attached` };
  };
  if (!isExternalUser(user) && !can(user, 'tickets.view', permissionContext)) {
    return failed('You do not have access to this ticket');
  }
  try {
    const uploads = await downloadFiles(config, files);
    await storeFiles(config, session, attach.ticketId, files, uploads);
  } catch (err) {
    if (err?.isOperational) return failed(err.message);
    logger.error('whatsapp attach failed', { ticketId: attach.ticketId, error: err.message });
    return failed('the file store didn\'t respond. Try again, or add it in the app.');
  }
  await audit('attach_added');
  logger.info('whatsapp files attached', { userId: String(user._id), ticketId: attach.ticketId, files: files.length });
  return {
    reply: `Added ${fileNames(files)} to *${attach.ticketId}*.`,
    status: `confirmed and applied, ${namesOf(files).join(', ')} attached`,
    attach,
  };
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

/**
 * What to reply to one incoming message, or null when it was already answered or needs no answer.
 * `storage` stands in for S3 in tests, as in attachment.service.js. `receipt`, if
 * given, is filled in: `accepted` once the message is taken up for a linked user
 * (the same gate as "typing"), and `read` once Meta has taken its read receipt.
 */
export async function answer(config, sender, message, { storage, receipt = {} } = {}) {
  // A 👍 on one of our replies is not a question.
  if (message.type === 'reaction') return null;
  try {
    await WhatsappState.create({ _id: `seen:${message.id}`, expiresAt: later(SEEN_TTL_MS) });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }

  const text = message.type === 'text' ? message.text?.body ?? '' : null;
  const linkCode = text && LINK_MESSAGE.exec(text)?.[1];
  if (linkCode) return tryLink(sender, linkCode, message.id);

  const link = await findLink(sender);
  if (!link) {
    await noteStranger(sender, message);
    return REPLIES.notLinked;
  }
  const session = await open(config, link, storage);
  if (typeof session === 'string') return session;
  const supported = message.type === 'text' || message.type === 'audio' || FILE_TYPES.has(message.type);
  if (!supported) return REPLIES.unsupported;
  receipt.accepted = true;
  const stopTyping = keepTyping(config, message.id);
  try {
    if (message.type === 'text') return await ask(config, session, text, message.id, message.timestamp);
    if (message.type === 'audio') return await listen(config, session, message);
    return await receiveFile(config, session, message);
  } finally {
    receipt.read = await stopTyping();
  }
}

/**
 * Marks the message read with "typing…" now, and again before Meta's 25 seconds
 * run out, until the answer is ready. If Meta refuses "typing…", the message is
 * still marked read on its own, unless it already is. Stopping waits for a call
 * still in flight, so it can't land after the reply and show the indicator again,
 * and says whether the message was marked read.
 */
function keepTyping(config, messageId) {
  let read = false;
  async function refresh() {
    if (await postRead(config, messageId, true)) read = true;
    else if (!read) read = await markRead(config, messageId);
  }
  let pending = refresh();
  // Remove this interval, keeping the first call, if Meta ignores a repeat for the same message.
  const timer = setInterval(() => { pending = refresh(); }, TYPING_REFRESH_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    return read;
  };
}

/** POSTs one message-endpoint payload to Meta. */
function postMessage(config, payload, timeoutMs) {
  return fetch(`${GRAPH}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** One read receipt for an incoming message, with "typing…" if asked. True when Meta took it; never throws. */
async function postRead(config, messageId, withTyping) {
  const payload = { status: 'read', message_id: messageId };
  if (withTyping) payload.typing_indicator = { type: 'text' };
  try {
    const res = await postMessage(config, payload, 5_000);
    if (!res.ok) logger.warn('whatsapp read receipt failed', { status: res.status, typing: withTyping });
    return res.ok;
  } catch (err) {
    logger.warn('whatsapp read receipt failed', { error: err.message, typing: withTyping });
    return false;
  }
}

/** Blue ticks for a message taken up: marks it read without "typing…". */
export function markRead(config, messageId) {
  return postRead(config, messageId, false);
}

/** Sends a text reply. True when Meta took it. */
export async function send(config, to, body) {
  const res = await postMessage(config, {
    to, type: 'text', text: { body: toWhatsapp(body).slice(0, MAX_BODY) },
  }, 15_000);
  if (!res.ok) logger.error('whatsapp send failed', { status: res.status, body: (await res.text()).slice(0, 500) });
  return res.ok;
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
