'use client';

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CATEGORIES, ENVIRONMENTS, PRIORITIES, SEVERITIES, speechLanguage, stageLabel,
} from '@pms/shared';
import Icon from '../icons.jsx';
import {
  getAssistantStatus, sendAssistantMessage, speakText, transcribeAudio,
} from '@/shared/api/assistant.js';
import {
  addComment, assignTicket, clearBlocked, createTicket, getTicket, patchTicket, resolveAttachmentDownloadUrl, setBlocked,
  transitionTicket, unwatchTicket, uploadAttachments, watchTicket,
} from '@/shared/api/tickets.js';
import { createClient, patchClient, uploadClientLogo } from '@/shared/api/clients.js';
import { createProject } from '@/shared/api/projects.js';
import { createTeam } from '@/shared/api/teams.js';
import { resetNotificationPrefs, updateNotificationPrefs } from '@/shared/api/users.js';
import { mutateNotifications } from '@/shared/lib/notification-swr.js';
import { isAbortError } from '@/shared/api/client.js';
import { TAB_PARAM, TICKET_PARAM } from '@/shared/lib/deep-link.js';
import { friendlyTransitionError, normalizeApiError } from '@/shared/lib/api-error.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useRealtime } from '@/shared/contexts/realtime-context.jsx';
import { requestModuleView, requestTicketFilters } from '@/shared/lib/assistant-ticket-filters.js';
import { clearAssistantChats, readSavedChat, saveChat } from '@/shared/lib/assistant-chat-storage.js';
import { useVoiceRecorder, voiceErrorMessage, watchForSpeech } from './use-voice-recorder.js';
import VoiceMode, { useLevelVar } from './voice-mode.jsx';
import UsageMeter from './usage-meter.jsx';
import ReportCard from './report-card.jsx';
import { downloadReport, reportPeriod, reportTitle } from '@/shared/lib/report-document.js';
import {
  AttachButton, FileDropZone, StagedFiles, fileDropProps, stageFiles,
} from './staged-files.jsx';
import { buildAttachmentFormData } from '@/shared/lib/attachment-config.js';

/** Turns sent per request; the server caps at 30. */
const HISTORY_LIMIT = 20;
/** List pages the assistant can page through with change_page. */
const PAGED_LISTS = ['/tickets', '/users', '/projects', '/teams'];
/** Matches the panel's exit animation in design-system.css. */
const PANEL_EXIT_MS = 160;
/** Matches voice mode's exit animation in design-system.css. */
const VOICE_EXIT_MS = 200;
const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
const SPEAK_KEY = 'assistant.speak';
/** Where the user is, so the assistant understands "this ticket" and "the details tab". */
export function currentPage() {
  const params = new URLSearchParams(window.location.search);
  return {
    path: window.location.pathname,
    ticketId: params.get(TICKET_PARAM),
    tab: params.get(TICKET_PARAM) ? (params.get(TAB_PARAM) || 'discussion') : null,
    // Filters, view and page, so "next page" or "remove that filter" is not a guess.
    query: window.location.search.slice(0, 1000),
  };
}

/**
 * Runs `fn` once the address shows `href` (the push has landed) and the new page
 * has had a moment to render.
 * ponytail: a fixed 400ms for the list to load; a slow list can still scroll short.
 */
function whenAt(href, fn) {
  const started = Date.now();
  const tick = () => {
    if (`${window.location.pathname}${window.location.search}` === href) window.setTimeout(fn, 400);
    else if (Date.now() - started < 3000) window.setTimeout(tick, 50);
  };
  tick();
}

function scrollWindow(direction) {
  const screen = window.innerHeight * 0.8;
  const top = { down: window.scrollY + screen, up: window.scrollY - screen, top: 0 }[direction]
    ?? document.documentElement.scrollHeight;
  window.scrollTo({ top, behavior: 'smooth' });
}

/** A short line per thing the app did for a reply, so the next turn knows (and "undo" isn't a guess). */
function actionNote(action) {
  switch (action.type) {
    case 'navigate': return `opened ${action.label}`;
    case 'switch_project': return `switched the project to ${action.label}`;
    case 'ticket_filters': return `set Tickets filters ${JSON.stringify({
      ...action.filters, ...(action.view ? { view: action.view } : {}), ...(action.sort ? { sort: action.sort } : {}),
      ...(action.limit ? { rows: action.limit } : {}), ...(action.reset ? { reset: true } : {}),
    })}`;
    case 'people_filters': return 'set People filters';
    case 'page_filters': return `set filters on ${action.path} ${JSON.stringify(action.params)}`;
    case 'module_view': return `module view: ${[action.action, action.modules ? action.modules.join(', ') : action.action && 'all',
      action.except ? `except ${action.except.join(', ')}` : '', action.order ? `order ${action.order}` : ''].filter(Boolean).join(' ')}`;
    case 'change_page': return `went to the ${action.direction === 'number' ? `page ${action.page}` : `${action.direction} page`}`;
    case 'scroll': return `scrolled ${action.direction}`;
    default: return null;
  }
}

/**
 * A playable URL for a streamed mp3 reply. Where the browser can feed mp3 to a
 * MediaSource (Chrome, Edge, Firefox) it plays as it arrives; elsewhere
 * (Safari, iOS) it waits for the whole clip.
 * ponytail: plain MediaSource only; try ManagedMediaSource if Safari's wait matters.
 */
async function playableUrl(response) {
  if (!response.body || !window.MediaSource?.isTypeSupported?.('audio/mpeg')) {
    return URL.createObjectURL(await response.blob());
  }
  const source = new MediaSource();
  source.addEventListener('sourceopen', async () => {
    const buffer = source.addSourceBuffer('audio/mpeg');
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        // Closed: the clip was stopped and its element let go of it.
        if (done || source.readyState !== 'open') break;
        buffer.appendBuffer(value);
        await new Promise((resolve) => { buffer.addEventListener('updateend', resolve, { once: true }); });
      }
      if (source.readyState === 'open') source.endOfStream();
    } catch {
      if (source.readyState === 'open') source.endOfStream('network');
    } finally {
      // Stops the download (and the server's synthesis) when playback was cut short.
      reader.cancel().catch(() => {});
    }
  }, { once: true });
  return URL.createObjectURL(source);
}

/** Errors that mean voice mode can't usefully go on; anything else it rides out. */
const VOICE_FATAL_CODES = new Set(['ASSISTANT_DAILY_LIMIT', 'ASSISTANT_BUDGET_EXHAUSTED', 'ASSISTANT_DISABLED']);
/** Shown wherever people talk to the assistant: what it is, and where their data goes. */
export const AI_NOTICE = 'AI assistant: it can make mistakes. Messages, voice and ticket details are processed by OpenAI.';
const TICKET_ID = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const SUGGESTIONS = ['What is overdue right now?', 'Open the board', 'How do I move a ticket to QA?'];

/** Splits text so ticket ids (WEB-55) can render as links to the ticket drawer. */
export function splitTicketIds(text) {
  const parts = [];
  let last = 0;
  for (const match of String(text).matchAll(TICKET_ID)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ ticketId: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function RichText({ text }) {
  return splitTicketIds(text).map((part, index) => (typeof part === 'string'
    ? part
    // Index keys are fine: parts are positional and never reorder.
    : <Link key={index} href={`/tickets?ticket=${encodeURIComponent(part.ticketId)}`}>{part.ticketId}</Link>));
}

/** **bold** spans, then ticket-id links inside each piece. */
function Inline({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, index) => (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4
    // Index keys are fine: pieces are positional and never reorder.
    ? <strong key={index}><RichText text={piece.slice(2, -2)} /></strong>
    : <RichText key={index} text={piece} />));
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Just enough formatting for chat replies: paragraphs, bullet or numbered
 * lists, bold. Anything else stays plain text (never HTML), so model output
 * can't inject markup.
 */
export function MessageText({ text }) {
  const blocks = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const item = LIST_ITEM.test(line);
    const ordered = /^\s*\d/.test(line);
    const last = blocks[blocks.length - 1];
    if (item && last?.type === 'list' && last.ordered === ordered) last.items.push(line.replace(LIST_ITEM, ''));
    else if (item) blocks.push({ type: 'list', ordered, items: [line.replace(LIST_ITEM, '')] });
    else blocks.push({ type: 'p', text: line });
  }
  return blocks.map((block, index) => {
    // Index keys are fine: blocks are positional and never reorder.
    if (block.type === 'p') return <p key={index}><Inline text={block.text} /></p>;
    const List = block.ordered ? 'ol' : 'ul';
    return (
      <List key={index}>
        {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
      </List>
    );
  });
}

const DRAFT_STATUS = {
  pending: 'waiting for the user to confirm',
  busy: 'being applied',
  done: 'confirmed and applied',
  dismissed: 'cancelled by the user',
  replaced: 'replaced by a newer draft',
};

/**
 * How a draft card reads to the model on later turns. Cards aren't chat text,
 * so without this the model forgets its own drafts ("no draft was created").
 * Carries the values as the user may have edited them.
 */
export function draftNote(action) {
  const { heading, rows } = describeAction(action);
  const details = rows.map(([label, value]) => `${label}: ${String(value).slice(0, 800)}`).join('; ');
  return `[Draft "${heading}": ${details}. Status: ${DRAFT_STATUS[action.status] || action.status}]`;
}

/** Drafts with the same key are revisions of one another. */
const draftKey = (action) => `${action.type}:${action.ticketId || action.ticketIds?.join(',') || action.clientId || ''}`;

/** What the model sees for a past message: its text plus notes for any drafts. */
export function historyText(message) {
  const notes = (message.actions || []).map(draftNote);
  if (message.report) notes.push(`[Report shown: ${reportTitle(message.report)}, ${message.report.from} to ${message.report.to}]`);
  if (message.did?.length) notes.push(`[Done in the app: ${message.did.join('; ')}]`);
  if (message.failed?.length) notes.push(`[Not done, the app said: ${message.failed.join('; ')}]`);
  const files = message.attached?.length
    ? [`[Files ready to attach: ${message.attached.map((file) => file.name).join(', ')}]`]
    : [];
  return [message.content, ...files, ...notes].filter(Boolean).join('\n');
}

const FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  stepsToReproduce: 'Steps',
  priority: 'Priority',
  severity: 'Severity',
  category: 'Category',
  environment: 'Environment',
  module: 'Module',
  page: 'Page',
  estimatedResolutionAt: 'Resolution date',
  expectedReleaseDate: 'Release date',
};

/** Heading and rows for a drafted change, in the user's terms. */
export function describeAction(action) {
  if (action.type === 'create_ticket') {
    const { body } = action;
    return {
      heading: `New ticket in ${action.projectKey}`,
      rows: [
        ['Title', body.title],
        ['Where', [body.module, body.page].filter(Boolean).join(' › ') || null],
        ['Category', body.category],
        ['Priority', body.priority],
        ['Severity', body.severity],
        ['Details', body.description],
      ].filter(([, value]) => value),
    };
  }
  if (action.type === 'create_project') {
    const { body } = action;
    return {
      heading: `New project for ${action.clientName}`,
      rows: [
        ['Name', body.name],
        ['Key', body.key || 'From the name'],
        ['About', body.description],
        ['Modules', body.modules.map((module) => (module.pages.length
          ? `${module.label} (${module.pages.map((page) => page.label).join(', ')})`
          : module.label)).join('; ') || 'None yet'],
      ].filter(([, value]) => value),
    };
  }
  if (action.type === 'create_team') {
    return {
      heading: 'New team',
      rows: [
        ['Name', action.body.name],
        ['Project', action.projectKey || 'All projects'],
        ['Lead', action.leadName || 'None'],
        ['Members', action.memberNames.join(', ') || 'None yet'],
      ],
    };
  }
  if (action.type === 'client_brand') {
    return {
      heading: action.clientId ? `Brand for ${action.currentName}` : 'New client',
      rows: [['Name', action.name], ['Logo', action.logoFile?.name || (action.hasLogo ? 'Keep current logo' : 'None')]],
    };
  }
  if (action.type === 'comment') {
    return {
      heading: `${action.internal ? 'Internal note' : 'Comment'} on ${action.ticketId}`,
      rows: [['Comment', action.content]],
    };
  }
  if (action.type === 'assign') {
    const many = action.ticketIds.length > 1;
    return {
      heading: many ? `Assign ${action.ticketIds.length} tickets` : `Assign ${action.ticketIds[0]}`,
      rows: [
        ...(many ? [['Tickets', action.ticketIds.join(', ')]] : [['From', action.from[0] || 'Unassigned']]),
        ['To', action.assigneeName || 'Unassigned'],
      ],
    };
  }
  if (action.type === 'block') {
    return {
      heading: action.blocked ? `Block ${action.ticketId}` : `Unblock ${action.ticketId}`,
      rows: action.blocked ? [['Reason', action.reason]] : [['Blocked', 'Clear it']],
    };
  }
  if (action.type === 'notification_settings') {
    const onOff = (value) => (value ? 'on' : 'off');
    return {
      heading: action.reset ? 'Restore default notifications' : 'Change notifications',
      rows: action.settings.map((setting) => [setting.label, [['In app', setting.inApp], ['Email', setting.email]]
        .filter(([, change]) => change)
        .map(([channel, change]) => `${channel} ${onOff(change.from)} → ${onOff(change.to)}`)
        .join(', ')]),
    };
  }
  if (action.type === 'attach_files') {
    return {
      heading: `Attach files to ${action.ticketId}`,
      rows: [
        ['Project', action.projectKey],
        ['Ticket', action.title],
        ['Files', action.files?.length ? action.files.map((file) => file.name).join(', ') : 'None chosen yet'],
        ['Comment', action.note],
      ].filter(([, value]) => value),
    };
  }
  if (action.type === 'update_ticket') {
    return {
      heading: `Update ${action.ticketId}`,
      rows: Object.entries(action.changes).map(([field, to]) => [
        FIELD_LABELS[field] || field,
        // Long text reads badly as "old → new"; show just the new version.
        field === 'description' || field === 'stepsToReproduce' ? to : `${action.from?.[field] ?? 'none'} → ${to}`,
      ]),
    };
  }
  const dateRows = [['Resolution date', action.dates?.due], ['Release date', action.dates?.release]];
  if (action.ticketIds) {
    return {
      heading: `Move ${action.ticketIds.length} tickets`,
      rows: [['Tickets', action.ticketIds.join(', ')], ['To', stageLabel(action.to)], ...dateRows, ['Note', action.note]]
        .filter(([, value]) => value),
    };
  }
  return {
    heading: `Move ${action.ticketId}`,
    rows: [['Stage', `${stageLabel(action.from)} → ${stageLabel(action.to)}`], ...dateRows, ['Note', action.note]]
      .filter(([, value]) => value),
  };
}

/**
 * Runs `work` on each ticket in turn. If one fails, the error says which were
 * already done (`done`) and which are left (`remaining`), so the card can be
 * retried for the rest instead of repeating the ones that went through.
 */
async function eachTicket(ticketIds, work) {
  for (const [index, ticketId] of ticketIds.entries()) {
    try {
      await work(ticketId);
    } catch (err) {
      err.done = ticketIds.slice(0, index);
      err.remaining = ticketIds.slice(index);
      throw err;
    }
  }
}

/** The move itself, with a fresh revision so a stale card fails as a conflict. */
async function moveTicket(action, ticketId) {
  let { revision } = await getTicket(ticketId);
  // Dates first: later stages refuse a ticket without them.
  const dates = {
    ...(action.dates?.due ? { estimatedResolutionAt: action.dates.due } : {}),
    ...(action.dates?.release ? { expectedReleaseDate: action.dates.release } : {}),
  };
  if (Object.keys(dates).length) {
    const updated = await patchTicket(ticketId, { ...dates, revision });
    revision = updated?.revision ?? (await getTicket(ticketId)).revision;
  }
  await transitionTicket(ticketId, {
    to: action.to,
    revision,
    // Closing requires a reason; the assistant collected it as the note.
    ...(action.note ? { [action.asReason ? 'reason' : 'note']: action.note } : {}),
  });
}

/** Applies a confirmed draft through the normal API for that thing; returns what happened. */
async function applyAction(action) {
  if (action.type === 'create_ticket') {
    const ticket = await createTicket(action.body);
    return `Created ${ticket.ticketId}.`;
  }
  if (action.type === 'create_project') {
    const project = await createProject(action.body);
    return `Created project ${project.name} (${project.key}).`;
  }
  if (action.type === 'create_team') {
    const team = await createTeam(action.body);
    return `Created team ${team.name}.`;
  }
  if (action.type === 'client_brand') {
    let clientId = action.clientId;
    if (!clientId) clientId = (await createClient({ name: action.name })).id;
    else if (action.name !== action.currentName) await patchClient(clientId, { name: action.name });
    if (action.logoFile) await uploadClientLogo(clientId, action.logoFile);
    return action.clientId ? `Updated the brand for ${action.name}.` : `Created client ${action.name}.`;
  }
  if (action.type === 'comment') {
    // The draft id as clientRef: a retry after a dropped response can't post twice.
    await addComment(action.ticketId, {
      content: action.content,
      internal: action.internal,
      clientRef: action.id,
      ...(action.mentions?.length ? { mentions: action.mentions } : {}),
    });
    return `Posted on ${action.ticketId}.`;
  }
  if (action.type === 'attach_files') {
    if (!action.files?.length) throw new Error('Add the files to attach first.');
    await uploadAttachments(action.ticketId, buildAttachmentFormData(action.files, {
      clientRef: action.id, commentContent: action.note, commentClientRef: `${action.id}:comment`,
    }));
    return `Attached ${action.files.length} file${action.files.length === 1 ? '' : 's'} to ${action.ticketId}.`;
  }
  if (action.type === 'notification_settings') {
    if (action.reset) {
      await resetNotificationPrefs();
      return 'Restored the default notification settings.';
    }
    const body = { inApp: {}, email: {} };
    action.settings.forEach((setting) => ['inApp', 'email'].forEach((channel) => {
      if (setting[channel]) body[channel][setting.event] = setting[channel].to;
    }));
    await updateNotificationPrefs(body);
    return 'Updated your notification settings.';
  }
  if (action.type === 'assign') {
    // ponytail: one request per ticket (max 50), so each gets its own revision check.
    await eachTicket(action.ticketIds, async (ticketId) => {
      const { revision } = await getTicket(ticketId);
      await assignTicket(ticketId, { assignedTo: action.assigneeId, revision });
    });
    const which = action.ticketIds.length > 1 ? `${action.ticketIds.length} tickets` : action.ticketIds[0];
    return action.assigneeName ? `Assigned ${which} to ${action.assigneeName}.` : `Unassigned ${which}.`;
  }
  if (action.type === 'stage_change' && action.ticketIds) {
    await eachTicket(action.ticketIds, (ticketId) => moveTicket(action, ticketId));
    return `Moved ${action.ticketIds.length} tickets to ${stageLabel(action.to)}.`;
  }
  // Fresh revision so a stale draft fails as a conflict instead of overwriting.
  const { revision } = await getTicket(action.ticketId);
  if (action.type === 'block') {
    if (action.blocked) await setBlocked(action.ticketId, { reason: action.reason, revision });
    else await clearBlocked(action.ticketId, { revision });
    return action.blocked ? `Marked ${action.ticketId} blocked.` : `Cleared blocked on ${action.ticketId}.`;
  }
  if (action.type === 'update_ticket') {
    await patchTicket(action.ticketId, { ...action.changes, revision });
    return `Updated ${action.ticketId}.`;
  }
  await moveTicket(action, action.ticketId);
  return `Moved ${action.ticketId} to ${stageLabel(action.to)}.`;
}

/**
 * Opens a ticket file in a new tab. The URL is fetched on click (it is a
 * short-lived signed link, and the download route re-checks access), and the
 * tab is opened first so the browser doesn't treat it as a popup.
 */
/** The assistant's own mark: a chat bubble holding a spark, so it reads as "ask the assistant", not "comments". */
function AssistantMark({ size = 22 }) {
  return (
    <svg className="assistant-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.99 16.34a2 2 0 0 1 .1 1.17l-1.07 3.29a1 1 0 0 0 1.24 1.17l3.41-1a2 2 0 0 1 1.1.1 10 10 0 1 0-4.78-4.73"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="assistant-mark-spark"
        d="M12 7.2c.45 2.5 2 4.05 4.5 4.5-2.5.45-4.05 2-4.5 4.5-.45-2.5-2-4.05-4.5-4.5 2.5-.45 4.05-2 4.5-4.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FileButton({ file }) {
  const [state, setState] = useState('idle');
  const open = async () => {
    const tab = window.open('', '_blank');
    setState('busy');
    try {
      const url = await resolveAttachmentDownloadUrl(file.ticketId, file.attachmentId);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setState('idle');
    } catch {
      tab?.close();
      setState('error');
    }
  };
  return (
    <button type="button" className="btn btn-sm assistant-file" disabled={state === 'busy'} onClick={open}>
      <Icon name="clip" size={13} aria-hidden="true" />
      <span>{state === 'error' ? `Couldn't open ${file.name}` : `Open ${file.name}`}</span>
    </button>
  );
}

function Choice({ label, value, options, onChange, disabled }) {
  return (
    <label className="assistant-field">
      <span>{label}</span>
      <select value={value || ''} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {!value ? <option value="">Choose…</option> : null}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

/**
 * A drafted ticket as an editable form: whatever the assistant filled in, the
 * user can correct before confirming, without another round of chat.
 */
export function TicketDraftFields({ action, onChange }) {
  const { body } = action;
  const busy = action.status === 'busy';
  // A field the user picks themselves is no longer a guess.
  const set = (patch) => onChange({ body: { ...body, ...patch }, guessed: action.guessed?.filter((field) => !(field in patch)) });
  const modules = action.modules || [];
  const pages = modules.find((module) => module.label === body.module)?.pages || [];
  // Fields the assistant inferred rather than was told, so the user checks those first.
  const label = (field, text) => (action.guessed?.includes(field) ? `${text} (guessed)` : text);
  return (
    <div className="assistant-draft">
      <label className="assistant-field is-wide">
        <span>Title</span>
        <input value={body.title} maxLength={200} disabled={busy} onChange={(event) => set({ title: event.target.value })} />
      </label>
      {modules.length ? (
        <>
          <Choice
            label={label('module', 'Module')}
            value={body.module}
            options={modules.map((module) => module.label)}
            disabled={busy}
            onChange={(module) => {
              const nextPages = modules.find((entry) => entry.label === module)?.pages || [];
              set({ module, page: nextPages.includes(body.page) ? body.page : nextPages[0] });
            }}
          />
          {pages.length ? (
            <Choice label={label('page', 'Page')} value={body.page} options={pages} disabled={busy} onChange={(page) => set({ page })} />
          ) : null}
        </>
      ) : null}
      <Choice label={label('category', 'Category')} value={body.category} options={CATEGORIES} disabled={busy} onChange={(category) => set({ category })} />
      <Choice label={label('severity', 'Severity')} value={body.severity} options={SEVERITIES} disabled={busy} onChange={(severity) => set({ severity })} />
      <Choice label={label('priority', 'Priority')} value={body.priority} options={PRIORITIES} disabled={busy} onChange={(priority) => set({ priority })} />
      <Choice label={label('environment', 'Environment')} value={body.environment} options={ENVIRONMENTS} disabled={busy} onChange={(environment) => set({ environment })} />
      <label className="assistant-field is-wide">
        <span>Details</span>
        <textarea
          rows={3}
          value={body.description}
          maxLength={5000}
          disabled={busy}
          onChange={(event) => set({ description: event.target.value })}
        />
      </label>
    </div>
  );
}

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Whether the draft, as edited, would pass the API's own validation. */
export function draftReady(action) {
  if (action.type === 'create_ticket') {
    return action.body.title.trim().length >= 5 && action.body.description.trim().length >= 10;
  }
  if (action.type === 'create_project') {
    return Boolean(action.body.name.trim()) && (!action.body.key || PROJECT_KEY.test(action.body.key));
  }
  if (action.type === 'client_brand') {
    return Boolean(action.name.trim()) && (!action.logoFile || action.logoFile.size <= MAX_LOGO_BYTES);
  }
  if (action.type === 'attach_files') return action.files?.length > 0;
  return true;
}

function ProjectDraftFields({ action, onChange }) {
  const { body } = action;
  const busy = action.status === 'busy';
  const set = (patch) => onChange({ body: { ...body, ...patch } });
  const keyInvalid = Boolean(body.key) && !PROJECT_KEY.test(body.key);
  return (
    <div className="assistant-draft">
      <label className="assistant-field is-wide">
        <span>Project name</span>
        <input value={body.name} maxLength={120} disabled={busy} onChange={(event) => set({ name: event.target.value })} />
      </label>
      <label className="assistant-field">
        <span>Key</span>
        <input
          value={body.key || ''}
          maxLength={10}
          placeholder="From the name"
          disabled={busy}
          aria-invalid={keyInvalid || undefined}
          onChange={(event) => set({ key: event.target.value.toUpperCase() || undefined })}
        />
      </label>
      <p className="assistant-field-note">
        {keyInvalid ? '2–10 letters or digits, starting with a letter.' : `Client: ${action.clientName}`}
      </p>
      <p className="assistant-field-note is-wide">
        Modules: {describeAction(action).rows.find(([label]) => label === 'Modules')[1]}
      </p>
    </div>
  );
}

function BrandDraftFields({ action, onChange }) {
  const busy = action.status === 'busy';
  const tooBig = action.logoFile && action.logoFile.size > MAX_LOGO_BYTES;
  return (
    <div className="assistant-draft">
      <label className="assistant-field is-wide">
        <span>Company name</span>
        <input value={action.name} maxLength={120} disabled={busy} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label className="assistant-field is-wide">
        <span>{action.hasLogo ? 'Replace logo (optional)' : 'Logo (optional)'}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={busy}
          onChange={(event) => onChange({ logoFile: event.target.files?.[0] || null })}
        />
      </label>
      {tooBig ? <p className="assistant-field-note is-wide" role="alert">Logos can be up to 2 MB.</p> : null}
    </div>
  );
}

function AttachDraftFields({ action, onChange }) {
  const busy = action.status === 'busy';
  const files = action.files || [];
  return (
    <div className="assistant-draft">
      <p className="assistant-field-note is-wide">
        {action.projectKey} · {action.ticketId}: {action.title}
      </p>
      <div className="assistant-field is-wide assistant-attach-field">
        <span>Files</span>
        <StagedFiles
          files={files}
          error={action.fileError}
          onRemove={(file) => onChange({ files: files.filter((entry) => entry !== file), fileError: null })}
        />
        <FileDropZone
          disabled={busy}
          hasFiles={files.length > 0}
          onAdd={(incoming) => {
            const next = stageFiles(files, incoming);
            onChange({ files: next.files, fileError: next.error });
          }}
        />
      </div>
      <label className="assistant-field is-wide">
        <span>Comment (optional)</span>
        <textarea
          rows={2}
          maxLength={10000}
          value={action.note || ''}
          disabled={busy}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </label>
    </div>
  );
}

const DRAFT_FIELDS = {
  create_ticket: TicketDraftFields,
  create_project: ProjectDraftFields,
  client_brand: BrandDraftFields,
  attach_files: AttachDraftFields,
};

function ActionCard({
  action, onConfirm, onDismiss, onChange,
}) {
  const { heading, rows } = describeAction(action);
  const Fields = (action.status === 'pending' || action.status === 'busy') && DRAFT_FIELDS[action.type];
  return (
    <div className={`assistant-action is-${action.status}`}>
      <p className="assistant-action-head">{heading}</p>
      {Fields ? <Fields action={action} onChange={onChange} /> : (
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {action.error ? <p className="assistant-action-error" role="alert">{action.error}</p> : null}
      {action.status === 'done' ? <p className="assistant-action-note">Done</p> : null}
      {action.status === 'dismissed' ? <p className="assistant-action-note">Cancelled</p> : null}
      {action.status === 'replaced' ? <p className="assistant-action-note">Replaced by the newer draft below</p> : null}
      {action.status === 'pending' || action.status === 'busy' ? (
        <div className="assistant-action-buttons">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={action.status === 'busy' || !draftReady(action)}
            onClick={onConfirm}
          >
            {action.status === 'busy' ? 'Working…' : action.error ? 'Try again' : 'Confirm'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={action.status === 'busy'} onClick={onDismiss}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Spoken answers to a waiting draft, and "stop" for hands-free. Anything else goes to the model. */
export function matchVoiceCommand(text) {
  const said = String(text).toLowerCase().replace(/[.,!?]/g, '').trim();
  // English, and the Hindi/Hinglish people actually say ("haan", "theek hai", "kar do", "nahi").
  if (/^(yes|yeah|yep|confirm|confirm it|confirmed|do it|go ahead|ok|okay|sure|haan|han|haan ji|ji haan|ha ji|theek hai|thik hai|achha|acha|accha|achcha|kar do|karo|post kar do|post karo|bhej do|हाँ|हां|ठीक है|कर दो)( please| ji)?$/.test(said)) return 'confirm';
  if (/^(no|nope|cancel|cancel it|never mind|nevermind|don't|do not|nahi|nahin|na|mat karo|rehne do|cancel karo|cancel kar do|नहीं|रहने दो)( please| ji)?$/.test(said)) return 'cancel';
  if (/^(stop|stop listening|goodbye|bye|that's all|that is all|thanks that's all|thank you that's all)$/.test(said)) return 'stop';
  return null;
}

/** How long Space must be held before the mic opens, so a tap never records. */
const HOLD_TO_TALK_MS = 250;

/**
 * Push-to-talk is a plain Space hold, but only where Space means nothing else:
 * not while typing, and not on a control that Space would press.
 */
export function isTalkKey(event) {
  if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return !target.closest(
    'input, textarea, select, button, a[href], summary, audio, video, [contenteditable]:not([contenteditable="false"]), '
      + '[role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], [role="textbox"]',
  );
}

function readSpeakPref() {
  try {
    return window.localStorage.getItem(SPEAK_KEY) === '1';
  } catch {
    return false;
  }
}

export default function AssistantWidget() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const userId = user?.id ?? null;
  const { activeProject, setActiveProjectId } = useProject();
  const { publish } = useRealtime();
  // Read at send time, so send() keeps a stable identity for the voice loop.
  const projectKeyRef = useRef(null);
  projectKeyRef.current = activeProject?.key ?? null;
  const [enabled, setEnabled] = useState(false);
  // Today's allowance for the usage ring: { percent, limitInr, usedInr, resetsAt }.
  const [usage, setUsage] = useState(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  // Voice mode just ended: the dock stays a moment, inert, to play its exit.
  const [voiceLeaving, setVoiceLeaving] = useState(false);
  const wasHandsFree = useRef(false);
  // Files added in the chat or voice dock, waiting for a confirmed ticket.
  const [staged, setStaged] = useState([]);
  const [stageError, setStageError] = useState(null);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const addFiles = useCallback((incoming) => {
    const next = stageFiles(stagedRef.current, incoming);
    setStaged(next.files);
    setStageError(next.error);
  }, []);
  const removeFile = useCallback((file) => {
    setStaged((prev) => prev.filter((entry) => entry !== file));
    setStageError(null);
  }, []);
  const {
    recording, record, stop: stopRecording, level: micLevel,
  } = useVoiceRecorder();
  const outputLevel = useRef(0);
  const outputContext = useRef(null);
  const [heard, setHeard] = useState('');
  const [closing, setClosing] = useState(false);
  // Messages from this index on arrived while the panel was open, so they animate in;
  // older ones (restored, or from before a reopen) just appear.
  const [enterFrom, setEnterFrom] = useState(0);
  const micButtonRef = useRef(null);
  const returnFocus = useRef(false);
  const speakButtonRef = useRef(null);
  const [lastReply, setLastReply] = useState('');
  // Between the reply arriving and its voice starting: still "thinking" to the user.
  const [preparingSpeech, setPreparingSpeech] = useState(false);
  // Replies that landed while the panel was shut; cleared when it opens.
  const [unread, setUnread] = useState(0);

  const openRef = useRef(open);
  openRef.current = open;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const speakOnRef = useRef(speakOn);
  speakOnRef.current = speakOn;
  const handsFreeRef = useRef(false);
  // The in-flight chat request, so an interruption can cancel it.
  const chatAbort = useRef(null);
  // Error code of the last failed send, for voice mode to decide whether to go on.
  const lastErrorCode = useRef(null);
  // Bumped on every interruption; a turn that finds it changed has been superseded.
  const voiceTurn = useRef(0);
  // Resolves the current turn's "tapped the orb" promise.
  const interruptTap = useRef(null);
  const pushToTalk = useRef(false);
  const audioRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fabRef = useRef(null);
  // Whose conversation `messages` holds; saving waits until it is known.
  const chatOwner = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getAssistantStatus()
      .then((status) => {
        if (cancelled) return;
        setEnabled(Boolean(status?.enabled));
        setUsage(status?.usage ?? null);
      })
      .catch(() => { /* no assistant: leave the button hidden */ });
    setSpeakOn(readSpeakPref());
    return () => { cancelled = true; };
  }, []);

  // Never saves an empty chat: in development React runs effects twice on
  // mount, and saving [] before the saved chat is read back would erase it.
  // Starting a new chat clears the saved one explicitly instead.
  useEffect(() => {
    if (chatOwner.current && messages.length) saveChat(chatOwner.current, messages);
  }, [messages]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);

  // After closing, focus goes back to the chat button once it is on screen again.
  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    fabRef.current?.focus();
  }, [open]);

  // Before paint, so reopening the panel doesn't replay every message's entrance.
  useLayoutEffect(() => {
    if (open) {
      setEnterFrom(messagesRef.current.length);
      setUnread(0);
    }
  }, [open]);

  // Live rings: the mic follows your voice while recording, the speaker follows the reply.
  useLevelVar(micButtonRef, '--mic-level', () => micLevel.current, recording && !handsFree);
  useLevelVar(speakButtonRef, '--out-level', () => outputLevel.current, speaking && !handsFree);

  useEffect(() => {
    if (open && !handsFree) inputRef.current?.focus();
  }, [open, handsFree]);

  /**
   * Browsers start audio contexts muted unless created in a click. This one
   * meters replies for the orb and the speaker button, so it is made (once)
   * from the click that turns voice on.
   */
  const unlockOutputAudio = useCallback(() => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    outputContext.current ??= new AudioCtx();
    outputContext.current.resume().catch(() => {});
  }, []);

  // Bumped on every stop, so a reply still being voiced knows not to play its next part.
  const speechSeq = useRef(0);
  const stopAudio = useCallback(() => {
    speechSeq.current += 1;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.onended?.(); // settles a waiting speak() and frees the blob URL
  }, []);

  useEffect(() => () => {
    stopAudio();
    outputContext.current?.close().catch(() => {});
  }, [stopAudio]);

  /** Re-reads today's allowance after anything that spends it. */
  const refreshUsage = useCallback(() => {
    getAssistantStatus()
      .then((status) => setUsage(status?.usage ?? null))
      .catch(() => { /* the ring keeps its last value */ });
  }, []);

  /** Plays one clip from its URL; resolves when it ends, is stopped, or fails. */
  const playClip = useCallback((src) => {
    const audio = new Audio(src);
    audioRef.current = audio;
    // Meter the reply's loudness for the voice-mode blob. Only through a context
    // started by a user gesture (voice mode's); a suspended one would mute it.
    let meter = null;
    const context = outputContext.current;
    if (context?.state === 'running') {
      try {
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(context.destination);
        const samples = new Float32Array(analyser.fftSize);
        meter = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          outputLevel.current = Math.sqrt(sum / samples.length);
        }, 50);
      } catch { /* play it unmetered */ }
    }
    return new Promise((resolve) => {
      audio.onended = () => {
        audio.onended = null;
        audio.onerror = null;
        window.clearInterval(meter);
        outputLevel.current = 0;
        if (audioRef.current === audio) audioRef.current = null;
        URL.revokeObjectURL(src);
        // Lets go of a still-streaming MediaSource, which ends its download.
        audio.removeAttribute('src');
        audio.load();
        resolve();
      };
      audio.onerror = audio.onended;
      // Wrapped so a play() that throws or returns nothing still settles the turn.
      Promise.resolve().then(() => audio.play()).catch(() => audio.onended?.());
    });
  }, []);

  /**
   * Reads text aloud as one streamed clip; resolves when playback ends, is
   * stopped, or fails. `onStart` fires as the voice starts, so a caption can
   * show the words as they are spoken rather than ahead of the voice.
   */
  const speak = useCallback(async (text, { onStart } = {}) => {
    stopAudio();
    const seq = speechSeq.current;
    setPreparingSpeech(true);
    try {
      let response;
      let src;
      try {
        // The route takes at most 2000 characters; voice replies are far shorter.
        response = await speakText(String(text).slice(0, 2000).trim(), { language: speechLanguage(text) });
        src = await playableUrl(response);
      } catch {
        return; // reading aloud is a bonus; the text is on screen either way
      }
      // Interrupted, replaced or switched off while the audio was on its way.
      if (seq !== speechSeq.current || (!speakOnRef.current && !handsFreeRef.current)) {
        URL.revokeObjectURL(src);
        response.body?.cancel().catch(() => {});
        return;
      }
      setPreparingSpeech(false);
      setSpeaking(true);
      onStart?.();
      await playClip(src);
    } finally {
      setPreparingSpeech(false);
      setSpeaking(false);
      refreshUsage();
    }
  }, [stopAudio, playClip, refreshUsage]);

  const updateAction = (id, patch) => setMessages((prev) => prev.map((message) => (message.actions
    ? { ...message, actions: message.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)) }
    : message)));

  /** Sends a user turn and runs any navigation right away. Resolves with the reply, or null on failure. */
  const send = useCallback(async (text) => {
    const content = text.trim();
    if (!content) return null;
    const attached = stagedRef.current.map((file) => ({ name: file.name, size: file.size }));
    const turn = `${Date.now()}-${Math.random()}`;
    const asked = { role: 'user', content, ...(attached.length ? { attached } : {}) };
    const next = [...messagesRef.current, asked];
    setMessages(next);
    setInput('');
    setError(null);
    setBusy(true);
    lastErrorCode.current = null;
    const controller = new AbortController();
    chatAbort.current = controller;
    try {
      const history = next
        .filter((message) => message.content)
        .slice(-HISTORY_LIMIT)
        .map((message) => ({ role: message.role, content: historyText(message).slice(0, 4000) }));
      const { reply, actions = [] } = await sendAssistantMessage(history, {
        signal: controller.signal,
        page: { ...currentPage(), project: projectKeyRef.current },
        ...(handsFreeRef.current ? { mode: 'voice' } : {}),
      });
      const files = actions.filter((action) => action.type === 'attachment');
      const drafts = actions.filter((action) => ![
        'navigate', 'attachment', 'switch_project', 'watch', 'ticket_filters', 'report', 'report_download', 'scroll', 'change_page', 'people_filters', 'page_filters', 'module_view',
      ].includes(action.type));
      const report = actions.find((action) => action.type === 'report')?.report;
      const answer = reply || (drafts.length ? 'Review the draft below.' : 'Sorry, I don\'t have an answer for that.');
      // A new draft of the same thing is a revision: retire the older pending card
      // so there is only ever one live version to confirm.
      const revised = new Set(drafts.map(draftKey));
      setMessages((prev) => [
        ...prev.map((message) => (message.actions?.some((action) => action.status === 'pending' && revised.has(draftKey(action)))
          ? {
            ...message,
            actions: message.actions.map((action) => (action.status === 'pending' && revised.has(draftKey(action))
              ? { ...action, status: 'replaced', error: null }
              : action)),
          }
          : message)),
        {
          role: 'assistant',
          turn,
          content: answer,
          files,
          ...(report ? { report } : {}),
          actions: drafts.map((action) => ({
            ...action,
            status: 'pending',
            // The card starts with the files the user already added.
            ...(action.type === 'attach_files' ? { files: stagedRef.current } : {}),
          })),
        },
      ]);
      // Voice mode already said it out loud, so only a silent, unseen reply counts.
      if (!openRef.current && !handsFreeRef.current) setUnread((count) => count + 1);
      // A report is too long for the voice card: open the chat beside it, voice stays on.
      if (report && handsFreeRef.current) setOpen(true);
      // What the app couldn't do is shown (chat and voice) and noted on the reply,
      // so the next turn knows the reply above it was wrong about it.
      const failed = [];
      const fail = (text) => {
        failed.push(text);
        setError(text);
      };
      const noteOnReply = (patch) => setMessages((prev) => prev.map((message) => (message.turn === turn
        ? { ...message, ...patch(message) } : message)));
      if (actions.some((action) => action.type === 'report_download')) {
        const latest = report ? { report, content: answer } : messagesRef.current.findLast((message) => message.report);
        if (latest) downloadReport(latest.report, latest.content);
        else fail('There is no report in this chat to download yet.');
      }
      // Watching only changes the user's own notifications, so it needs no card.
      for (const action of actions.filter((entry) => entry.type === 'watch')) {
        (action.watch ? watchTicket : unwatchTicket)(action.ticketId).catch((err) => {
          const text = normalizeApiError(err)?.message || `Couldn't update watching ${action.ticketId}.`;
          setError(text);
          noteOnReply((message) => ({ failed: [...(message.failed || []), text] }));
        });
      }
      // Same as picking it in the project switcher; before the page change so it opens in it.
      // The server allows one action of each kind, all for one page, per turn.
      const one = (type) => actions.find((action) => action.type === type);
      const switched = one('switch_project');
      if (switched) setActiveProjectId(switched.projectId);

      // Every page change of this turn builds one address, pushed once at the end.
      const here = () => new URL(window.location.href);
      const fresh = (path) => (window.location.pathname === path ? here() : new URL(path, window.location.origin));
      const destination = one('navigate');
      let target = destination ? new URL(destination.href, window.location.origin) : null;

      // People and the other URL-driven pages: merge into the one on screen, from page 1.
      const people = one('people_filters');
      if (people) {
        target ??= fresh('/users');
        target.searchParams.delete('q');
        target.searchParams.delete('page');
        for (const key of ['search', 'role', 'status', 'limit']) {
          if (people[key] === undefined) continue;
          if (people[key] === 'any' || people[key] === '') target.searchParams.delete(key);
          else target.searchParams.set(key, people[key]);
        }
      }
      const pageFilters = one('page_filters');
      if (pageFilters) {
        target ??= fresh(pageFilters.path);
        target.searchParams.delete('page');
        for (const [key, value] of Object.entries(pageFilters.params)) {
          if (value == null) target.searchParams.delete(key);
          else target.searchParams.set(key, value);
        }
      }

      // The Tickets page takes its filters itself (it merges them into the saved view).
      // Module-view steps need the By module view: ask for it with the filters (one request).
      const moduleSteps = actions.filter((action) => action.type === 'module_view');
      const inModuleView = window.location.pathname === '/tickets' && here().searchParams.get('view') === 'modules';
      let filters = one('ticket_filters');
      if (moduleSteps.length && !inModuleView) filters = { filters: {}, ...filters, view: 'modules' };

      // Paging applies to where this turn lands; with Tickets filters the page does it after them.
      const paging = one('change_page');
      if (paging && filters) filters = { filters: {}, ...filters, paging };
      else if (paging) {
        target ??= here();
        if (!PAGED_LISTS.includes(target.pathname)) {
          fail('Paging works on the Tickets, People, Projects and Teams lists.');
        } else {
          const current = Number(target.searchParams.get('page')) || 1;
          // ponytail: "last" asks for a huge page and lets the list clamp it (one extra fetch).
          const next = {
            next: current + 1, previous: Math.max(1, current - 1), first: 1, last: 100000,
          }[paging.direction] ?? paging.page;
          target.searchParams.set('page', String(next));
        }
      }
      if (moduleSteps.length) requestModuleView(moduleSteps);
      if (filters) {
        requestTicketFilters(filters);
        if (!target && window.location.pathname !== '/tickets') target = new URL('/tickets', window.location.origin);
      }

      const href = target ? `${target.pathname}${target.search}` : null;
      const moving = href && href !== `${window.location.pathname}${window.location.search}`;
      if (moving) router.push(href);

      // ponytail: scrolls the window only; a page with its own scroll area (the ticket drawer) needs a target.
      const scroll = one('scroll');
      if (scroll) {
        if (moving) whenAt(href, () => scrollWindow(scroll.direction));
        else if (filters) window.setTimeout(() => scrollWindow(scroll.direction), 600); // after the list redraws
        else scrollWindow(scroll.direction);
      }

      const did = actions.map(actionNote).filter(Boolean);
      if (did.length || failed.length) noteOnReply(() => ({ did, failed }));
      // On a phone the sheet covers the page, so get out of the way (unless talking hands-free),
      // but not when there is a card to confirm or a failure to read.
      if (destination && !handsFreeRef.current && !drafts.length && !failed.length
        && window.matchMedia?.('(max-width: 560px)')?.matches) {
        if (openRef.current) setUnread((count) => count + 1); // closed before it could be read
        setOpen(false);
      }
      return answer;
    } catch (err) {
      // An interruption cancels the request on purpose: nothing to report. The question
      // goes too, so a retracted "open the board" can't win the next turn.
      if (isAbortError(err) || controller.signal.aborted) {
        setMessages((prev) => prev.filter((message) => message !== asked));
        return null;
      }
      lastErrorCode.current = normalizeApiError(err)?.code ?? null;
      setError(normalizeApiError(err)?.message || 'The assistant could not answer. Try again.');
      return null;
    } finally {
      if (chatAbort.current === controller) chatAbort.current = null;
      setBusy(false);
      refreshUsage();
    }
  }, [router, refreshUsage, setActiveProjectId]);

  /** Applies or rejects a draft. Resolves with a short sentence saying what happened. */
  const resolveDraft = useCallback(async (action, confirm) => {
    if (!confirm) {
      updateAction(action.id, { status: 'dismissed', error: null });
      return 'Cancelled.';
    }
    updateAction(action.id, { status: 'busy', error: null });
    try {
      const outcome = await applyAction(action);
      updateAction(action.id, { status: 'done' });
      if (action.type === 'attach_files') {
        setStaged((prev) => prev.filter((file) => !action.files.includes(file)));
      }
      if (action.type === 'notification_settings') {
        // So an open settings page, and the notification list, show the new settings.
        // The change already landed; a failed refresh only leaves the page stale until reload.
        refreshUser().catch(() => {});
        mutateNotifications();
      }
      // Refresh the ticket drawer and list on screen, which the server doesn't
      // notify about the user's own changes.
      const ticketIds = action.ticketIds || (action.ticketId ? [action.ticketId] : []);
      const type = action.type === 'comment' || action.type === 'attach_files' ? 'ticket.comment' : 'ticket.updated';
      ticketIds.forEach((ticketId) => publish({ type, ticketId, self: true }));
      // Recorded as an assistant turn so the model knows the change landed.
      setMessages((prev) => [...prev, { role: 'assistant', content: outcome }]);
      return outcome;
    } catch (err) {
      const reason = (action.type === 'stage_change'
        ? friendlyTransitionError(err)
        : normalizeApiError(err))?.message || 'That didn\'t work. Try again.';
      if (!err.done?.length) {
        updateAction(action.id, { status: 'pending', error: reason });
        return reason;
      }
      // Part of a batch went through: show those as done, keep the rest on the card.
      err.done.forEach((ticketId) => publish({ type: 'ticket.updated', ticketId, self: true }));
      const skip = err.done.length;
      const message = `Done: ${err.done.join(', ')}. ${err.remaining[0]}: ${reason}`;
      updateAction(action.id, {
        status: 'pending',
        error: message,
        ticketIds: err.remaining,
        ...(action.froms ? { froms: action.froms.slice(skip) } : {}),
        ...(Array.isArray(action.from) ? { from: action.from.slice(skip) } : {}),
      });
      return message;
    }
  }, [publish, refreshUser]);

  /**
   * Everything the user says or types lands here. "Confirm"/"cancel" answers
   * the waiting draft locally when there is exactly one, so a voice user never
   * has to click; anything else is a normal chat turn.
   * Resolves with text worth reading aloud, 'stop', or null.
   */
  const handleUtterance = useCallback(async (text) => {
    const command = matchVoiceCommand(text);
    if (command === 'stop') return 'stop';
    // "Confirm" answers the newest card: the latest message that still has one
    // waiting. Older cards left pending further up must not block it.
    const latest = [...messagesRef.current].reverse()
      .find((message) => message.actions?.some((action) => action.status === 'pending'));
    const waiting = (latest?.actions || []).filter((action) => action.status === 'pending');
    if ((command === 'confirm' || command === 'cancel') && waiting.length === 1) {
      setMessages((prev) => [...prev, { role: 'user', content: text.trim() }]);
      return resolveDraft(waiting[0], command === 'confirm');
    }
    return send(text);
  }, [resolveDraft, send]);

  /** Recording to text. '' means nothing intelligible; null means the request failed. */
  const transcribe = useCallback(async (blob) => {
    setTranscribing(true);
    try {
      return (await transcribeAudio(blob)).text?.trim() || '';
    } catch (err) {
      setError(normalizeApiError(err)?.message || 'Could not understand the recording.');
      return null;
    } finally {
      setTranscribing(false);
      refreshUsage();
    }
  }, [refreshUsage]);

  /** One spoken turn (mic button or push-to-talk): listen, answer, read aloud if enabled. */
  const talkOnce = useCallback(async ({ autoStop }) => {
    setError(null);
    stopAudio();
    let blob;
    try {
      blob = await record({ autoStop });
    } catch (err) {
      setError(voiceErrorMessage(err));
      return;
    }
    if (!blob) return;
    const text = await transcribe(blob);
    if (text === '') setError('I didn\'t catch that. Try again.');
    if (!text) return;
    const answer = await handleUtterance(text);
    if (answer && answer !== 'stop' && speakOnRef.current) await speak(answer);
  }, [handleUtterance, record, speak, stopAudio, transcribe]);

  // A different person in this tab (sign-in, impersonation, or its end) gets their
  // own conversation: never the previous one, which can hold ticket details.
  useEffect(() => {
    handsFreeRef.current = false;
    setHandsFree(false);
    stopRecording();
    stopAudio();
    clearAssistantChats(userId);
    chatOwner.current = userId;
    setMessages(readSavedChat(userId));
    setInput('');
    setError(null);
    setHeard('');
    setLastReply('');
  }, [userId, stopAudio, stopRecording]);

  const endHandsFree = useCallback(() => {
    handsFreeRef.current = false;
    setHandsFree(false);
    stopRecording();
    stopAudio();
    chatAbort.current?.abort();
    interruptTap.current?.();
  }, [stopAudio, stopRecording]);

  /** Cuts off whatever the assistant is doing (thinking or speaking) so the user can talk. */
  const interrupt = useCallback(() => {
    voiceTurn.current += 1;
    chatAbort.current?.abort();
    stopAudio();
  }, [stopAudio]);

  /**
   * One spoken exchange after the user has finished talking: transcribe, answer,
   * read the answer aloud. Bails out quietly if it has been interrupted.
   * Resolves with 'done', 'stop', 'fatal' or 'error'.
   */
  const runVoiceTurn = useCallback(async (blob, turn) => {
    const current = () => turn === voiceTurn.current && handsFreeRef.current;
    const text = await transcribe(blob);
    if (!current()) return 'done';
    if (text === null) return 'error'; // transcribe() already showed why
    if (!text) return 'done';
    setHeard(text);
    setLastReply('');
    const answer = await handleUtterance(text);
    if (!current()) return 'done';
    if (answer === 'stop') return 'stop';
    if (answer === null) return VOICE_FATAL_CODES.has(lastErrorCode.current) ? 'fatal' : 'error';
    // The caption appears with the voice instead of running ahead of it.
    await speak(answer, { onStart: () => { if (current()) setLastReply(answer); } });
    if (current()) setLastReply(answer); // in full, whether or not it could be spoken
    return 'done';
  }, [handleUtterance, speak, transcribe]);

  /**
   * Listen, answer out loud, listen again: until the user ends it, says "stop",
   * or goes quiet. While the assistant thinks or speaks, the user can cut in by
   * talking (or tapping the orb): the reply stops, the pending request is
   * cancelled, and it listens again straight away.
   */
  const startHandsFree = useCallback(async () => {
    handsFreeRef.current = true;
    setHandsFree(true);
    setError(null);
    setHeard('');
    setLastReply('');
    stopAudio();
    unlockOutputAudio();
    let problem = null;
    while (handsFreeRef.current) {
      let blob;
      try {
        // Sequential on purpose: each turn waits for the previous answer.
        blob = await record({ autoStop: true });
      } catch (err) {
        problem = voiceErrorMessage(err);
        break;
      }
      if (!handsFreeRef.current) break;
      if (!blob) {
        problem = 'Voice mode ended because I didn\'t hear anything.';
        break;
      }
      voiceTurn.current += 1;
      const turn = voiceTurn.current;
      const cutIn = watchForSpeech();
      const tapped = new Promise((resolve) => { interruptTap.current = resolve; });
      // An unexpected failure counts as a failed turn, never a stuck voice mode.
      const outcome = await Promise.race([
        runVoiceTurn(blob, turn).catch(() => 'error'),
        cutIn.done.then(() => 'interrupted'),
        tapped.then(() => 'interrupted'),
      ]);
      cutIn.cancel();
      interruptTap.current = null;
      if (outcome === 'interrupted') {
        interrupt();
        setLastReply('');
        continue;
      }
      if (outcome === 'stop') break;
      if (outcome === 'fatal') {
        problem = ''; // send() already showed why
        break;
      }
      // 'error' is shown and voice goes on: one failed turn shouldn't end the conversation.
    }
    const endedByUser = !handsFreeRef.current;
    endHandsFree();
    // Voice mode may have been started without the chat open; show why it stopped.
    if (!endedByUser && problem !== null) {
      if (problem) setError(problem);
      setOpen(true);
    }
  }, [endHandsFree, interrupt, record, runVoiceTurn, stopAudio, unlockOutputAudio]);

  // Push-to-talk from anywhere in the app: hold Space, release to send.
  useEffect(() => {
    if (!enabled) return undefined;
    let holdTimer = null;
    const onDown = (event) => {
      if (!isTalkKey(event)) return;
      // Space would otherwise scroll the page on every tap and auto-repeat.
      event.preventDefault();
      if (event.repeat || holdTimer || pushToTalk.current) return;
      if (handsFreeRef.current || busy || transcribing) return;
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        pushToTalk.current = true;
        setOpen(true);
        talkOnce({ autoStop: false });
      }, HOLD_TO_TALK_MS);
    };
    const onUp = (event) => {
      if (event.code !== 'Space') return;
      if (holdTimer) {
        window.clearTimeout(holdTimer); // a tap, not a hold
        holdTimer = null;
      }
      if (pushToTalk.current) {
        pushToTalk.current = false;
        stopRecording();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [enabled, busy, transcribing, talkOnce, stopRecording]);

  const toggleMic = () => {
    if (recording) stopRecording();
    else talkOnce({ autoStop: true });
  };

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOn(next);
    if (next) unlockOutputAudio();
    if (!next && !handsFreeRef.current) stopAudio();
    try {
      window.localStorage.setItem(SPEAK_KEY, next ? '1' : '0');
    } catch { /* storage blocked: preference lasts this visit */ }
  };

  useEffect(() => {
    const ended = wasHandsFree.current && !handsFree;
    wasHandsFree.current = handsFree;
    if (!ended || prefersReducedMotion()) {
      setVoiceLeaving(false);
      return undefined;
    }
    setVoiceLeaving(true);
    const timer = window.setTimeout(() => setVoiceLeaving(false), VOICE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [handsFree]);

  const close = () => {
    // With voice on (the chat was opened beside it for a report), closing only hides the chat.
    if (!handsFree) {
      endHandsFree();
      stopRecording();
    }
    const finish = () => {
      returnFocus.current = true;
      setClosing(false);
      setOpen(false);
    };
    // Play the exit animation first, unless the user prefers no motion.
    if (prefersReducedMotion()) finish();
    else {
      setClosing(true);
      window.setTimeout(finish, PANEL_EXIT_MS);
    }
  };

  const startNewChat = () => {
    endHandsFree();
    stopAudio();
    saveChat(chatOwner.current, []);
    setMessages([]);
    setInput('');
    setError(null);
    inputRef.current?.focus();
  };

  if (!enabled) return null;

  // The newest draft still waiting (or being applied), for voice mode's preview.
  const pendingDraft = messages.flatMap((message) => message.actions || [])
    .filter((action) => action.status === 'pending' || action.status === 'busy')
    .at(-1);
  const voicePhase = recording ? 'listening'
    : transcribing ? 'transcribing'
      : busy || preparingSpeech ? 'thinking'
        : speaking ? 'speaking'
          : 'idle';
  // The report from the latest reply, for voice mode's shortcut to it.
  const lastMessage = messages.at(-1);
  const voiceReport = lastMessage?.report ? {
    title: reportTitle(lastMessage.report),
    period: reportPeriod(lastMessage.report),
    download: () => downloadReport(lastMessage.report, lastMessage.content),
  } : null;
  const voiceMode = handsFree || voiceLeaving ? (
    <VoiceMode
      leaving={!handsFree}
      phase={voicePhase}
      besidePanel={open}
      report={voiceReport}
      onShowReport={() => setOpen(true)}
      heard={heard}
      reply={lastReply}
      draft={pendingDraft ? { ...describeAction(pendingDraft), status: pendingDraft.status, error: pendingDraft.error } : null}
      draftReady={pendingDraft ? draftReady(pendingDraft) : false}
      draftFiles={pendingDraft?.type === 'attach_files' ? (pendingDraft.files || []) : null}
      draftFileError={pendingDraft?.fileError ?? null}
      onDraftFiles={(incoming) => {
        const next = stageFiles(pendingDraft.files || [], incoming);
        updateAction(pendingDraft.id, { files: next.files, fileError: next.error });
      }}
      onDraftRemoveFile={(file) => updateAction(pendingDraft.id, {
        files: (pendingDraft.files || []).filter((entry) => entry !== file), fileError: null,
      })}
      onConfirmDraft={async () => setLastReply(await resolveDraft(pendingDraft, true))}
      onCancelDraft={async () => setLastReply(await resolveDraft(pendingDraft, false))}
      onEditDraft={() => {
        endHandsFree();
        setOpen(true);
      }}
      micLevel={micLevel}
      outputLevel={outputLevel}
      files={staged}
      fileError={stageError}
      onAddFiles={addFiles}
      onRemoveFile={removeFile}
      onInterrupt={() => interruptTap.current?.()}
      usage={usage}
      onUsageReset={refreshUsage}
      notice={AI_NOTICE}
      error={error}
      onEnd={endHandsFree}
      onShowChat={() => {
        endHandsFree();
        setOpen(true);
      }}
    />
  ) : null;

  if (!open) {
    return (
      <>
        {voiceMode}
        {handsFree ? null : (
          <div className="assistant-fabs">
            <button
              type="button"
              className="assistant-fab is-voice"
              aria-label="Start voice mode"
              title="Voice mode: talk with the assistant"
              onClick={startHandsFree}
            >
              <Icon name="voice" size={20} className="assistant-voice-icon" aria-hidden="true" />
            </button>
            <button
              ref={fabRef}
              type="button"
              className="assistant-fab"
              aria-label={unread ? `Open assistant, ${unread} new ${unread === 1 ? 'reply' : 'replies'}` : 'Open assistant'}
              title="Assistant (hold Space to talk)"
              onClick={() => setOpen(true)}
            >
              <AssistantMark />
              {unread ? <span className="assistant-fab-dot" aria-hidden="true" /> : null}
            </button>
          </div>
        )}
      </>
    );
  }

  const activity = recording ? 'Listening…'
    : transcribing ? 'Transcribing…'
      : busy ? 'Thinking…'
        : speaking ? 'Speaking…'
          : null;
  const placeholder = recording ? 'Listening… just stop talking when you\'re done'
    : transcribing ? 'Transcribing…'
      : 'Ask about tickets, or say where to go';

  return (
    <>
      {voiceMode}
      <section
        className={`assistant-panel${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="assistant-title"
        onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
        {...fileDropProps(addFiles)}
      >
        <header className="assistant-head">
          <div className="assistant-title">
            <h2 id="assistant-title">Assistant</h2>
            <span className="assistant-status" aria-live="polite">{activity || (handsFree ? 'Hands-free' : '')}</span>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="assistant-icon-btn"
            aria-label="New chat"
            title="New chat"
            disabled={!messages.length || busy}
            onClick={startNewChat}
          >
            <Icon name="new-chat" size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="assistant-icon-btn"
            aria-pressed={handsFree}
            aria-label="Voice mode"
            title="Voice mode: talk back and forth without tapping"
            disabled={!handsFree && (busy || transcribing || recording)}
            onClick={() => {
            if (handsFree) {
              endHandsFree();
              return;
            }
            // The voice dock lives in the same corner as this panel; hand over to it.
            setOpen(false);
            startHandsFree();
          }}
          >
            <Icon name="voice" size={18} className="assistant-voice-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            ref={speakButtonRef}
            className={`assistant-icon-btn assistant-speaker${speaking ? ' is-speaking' : ''}`}
            aria-pressed={speakOn}
            aria-label="Read replies aloud"
            title={speakOn ? 'Reading replies aloud' : 'Read replies aloud'}
            onClick={toggleSpeak}
          >
            <Icon name={speakOn ? 'volume' : 'volume-off'} size={18} aria-hidden="true" />
          </button>
          <button type="button" className="assistant-icon-btn" aria-label="Close assistant" onClick={close}>
            <Icon name="x" size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="assistant-log" ref={logRef} aria-live="polite">
          {messages.length === 0 ? (
            <div className="assistant-empty">
              <p>
                Ask about your tickets, file a new one, or say where to go, like &ldquo;open the board&rdquo; or
                &ldquo;show overdue tickets&rdquo;. Tap the mic to talk, or hold <kbd>Space</kbd> anywhere outside a text box.
              </p>
              <p>It only helps with this app, not general questions, writing or coding.</p>
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" className="btn btn-sm" onClick={() => handleUtterance(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message, index) => (
            // Index keys are fine: the log only ever appends.
            <div key={index} className={`assistant-msg is-${message.role}${index >= enterFrom ? ' is-new' : ''}`}>
              <div className="assistant-bubble"><MessageText text={message.content} /></div>
              {message.attached?.length ? (
                <p className="assistant-msg-files">
                  <Icon name="clip" size={12} aria-hidden="true" />
                  {message.attached.map((file) => file.name).join(', ')}
                </p>
              ) : null}
              {message.files?.length ? (
                <div className="assistant-files">
                  {message.files.map((file) => <FileButton key={file.id} file={file} />)}
                </div>
              ) : null}
              {message.report ? (
                <ReportCard report={message.report} onDownload={() => downloadReport(message.report, message.content)} />
              ) : null}
              {message.actions?.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onConfirm={() => resolveDraft(action, true)}
                  onDismiss={() => resolveDraft(action, false)}
                  onChange={(patch) => updateAction(action.id, patch)}
                />
              ))}
            </div>
          ))}
          {busy ? (
            <div className="assistant-msg is-assistant assistant-typing" role="status" aria-label="Assistant is thinking">
              <span /><span /><span />
            </div>
          ) : null}
        </div>

        {error ? <p className="assistant-error" role="alert">{error}</p> : null}

        <StagedFiles files={staged} error={stageError} onRemove={removeFile} />
        <form
          className="assistant-compose"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) handleUtterance(input);
          }}
        >
          <button
            type="button"
            ref={micButtonRef}
            className={`assistant-icon-btn assistant-mic${recording ? ' is-recording' : ''}`}
            aria-pressed={recording}
            aria-label={recording ? 'Stop recording and send' : 'Speak your message'}
            title="Tap and speak; it sends when you stop talking"
            disabled={busy || transcribing}
            onClick={toggleMic}
          >
            <Icon name={recording ? 'stop' : 'mic'} size={18} aria-hidden="true" />
          </button>
          <AttachButton onAdd={addFiles} disabled={busy} />
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={4000}
            placeholder={placeholder}
            aria-label="Message the assistant"
            disabled={recording || transcribing}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!busy) handleUtterance(input);
              }
            }}
          />
          <button type="submit" className="assistant-icon-btn assistant-send" aria-label="Send" disabled={busy || !input.trim()}>
            <Icon name="send" size={18} aria-hidden="true" />
          </button>
        </form>
        <div className="assistant-footer">
          <UsageMeter usage={usage} onReset={refreshUsage} />
          <p className="assistant-disclaimer">{AI_NOTICE}</p>
        </div>
      </section>
    </>
  );
}
