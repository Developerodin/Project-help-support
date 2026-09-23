'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CATEGORIES, ENVIRONMENTS, PRIORITIES, SEVERITIES, stageLabel,
} from '@pms/shared';
import Icon from '../icons.jsx';
import {
  getAssistantStatus, sendAssistantMessage, speakText, transcribeAudio,
} from '@/shared/api/assistant.js';
import {
  createTicket, getTicket, patchTicket, resolveAttachmentDownloadUrl, transitionTicket,
} from '@/shared/api/tickets.js';
import { createClient, patchClient, uploadClientLogo } from '@/shared/api/clients.js';
import { createProject } from '@/shared/api/projects.js';
import { createTeam } from '@/shared/api/teams.js';
import { friendlyTransitionError, normalizeApiError } from '@/shared/lib/api-error.js';
import { useVoiceRecorder, voiceErrorMessage } from './use-voice-recorder.js';

/** Turns sent per request; the server caps at 30. */
const HISTORY_LIMIT = 20;
const SPEAK_KEY = 'assistant.speak';
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

const FIELD_LABELS = { title: 'Title', priority: 'Priority', severity: 'Severity', category: 'Category', module: 'Module', page: 'Page' };

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
  if (action.type === 'update_ticket') {
    return {
      heading: `Update ${action.ticketId}`,
      rows: Object.entries(action.changes).map(([field, to]) => [
        FIELD_LABELS[field] || field, `${action.from?.[field] ?? 'none'} → ${to}`,
      ]),
    };
  }
  return {
    heading: `Move ${action.ticketId}`,
    rows: [['Stage', `${stageLabel(action.from)} → ${stageLabel(action.to)}`], ['Note', action.note]]
      .filter(([, value]) => value),
  };
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
  // Fresh revision so a stale draft fails as a conflict instead of overwriting.
  const { revision } = await getTicket(action.ticketId);
  if (action.type === 'update_ticket') {
    await patchTicket(action.ticketId, { ...action.changes, revision });
    return `Updated ${action.ticketId}.`;
  }
  await transitionTicket(action.ticketId, {
    to: action.to, revision, ...(action.note ? { note: action.note } : {}),
  });
  return `Moved ${action.ticketId} to ${stageLabel(action.to)}.`;
}

/**
 * Opens a ticket file in a new tab. The URL is fetched on click (it is a
 * short-lived signed link, and the download route re-checks access), and the
 * tab is opened first so the browser doesn't treat it as a popup.
 */
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
function TicketDraftFields({ action, onChange }) {
  const { body } = action;
  const busy = action.status === 'busy';
  const set = (patch) => onChange({ body: { ...body, ...patch } });
  const modules = action.modules || [];
  const pages = modules.find((module) => module.label === body.module)?.pages || [];
  return (
    <div className="assistant-draft">
      <label className="assistant-field is-wide">
        <span>Title</span>
        <input value={body.title} maxLength={200} disabled={busy} onChange={(event) => set({ title: event.target.value })} />
      </label>
      {modules.length ? (
        <>
          <Choice
            label="Module"
            value={body.module}
            options={modules.map((module) => module.label)}
            disabled={busy}
            onChange={(module) => {
              const nextPages = modules.find((entry) => entry.label === module)?.pages || [];
              set({ module, page: nextPages.includes(body.page) ? body.page : nextPages[0] });
            }}
          />
          {pages.length ? (
            <Choice label="Page" value={body.page} options={pages} disabled={busy} onChange={(page) => set({ page })} />
          ) : null}
        </>
      ) : null}
      <Choice label="Category" value={body.category} options={CATEGORIES} disabled={busy} onChange={(category) => set({ category })} />
      <Choice label="Severity" value={body.severity} options={SEVERITIES} disabled={busy} onChange={(severity) => set({ severity })} />
      <Choice label="Priority" value={body.priority} options={PRIORITIES} disabled={busy} onChange={(priority) => set({ priority })} />
      <Choice label="Environment" value={body.environment} options={ENVIRONMENTS} disabled={busy} onChange={(environment) => set({ environment })} />
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

const DRAFT_FIELDS = {
  create_ticket: TicketDraftFields,
  create_project: ProjectDraftFields,
  client_brand: BrandDraftFields,
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
  if (/^(yes|yeah|yep|confirm|confirm it|confirmed|do it|go ahead|ok|okay|sure)( please)?$/.test(said)) return 'confirm';
  if (/^(no|nope|cancel|cancel it|never mind|nevermind|don't|do not)$/.test(said)) return 'cancel';
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
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const { recording, record, stop: stopRecording } = useVoiceRecorder();

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const speakOnRef = useRef(speakOn);
  speakOnRef.current = speakOn;
  const handsFreeRef = useRef(false);
  const pushToTalk = useRef(false);
  const audioRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fabRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getAssistantStatus()
      .then((status) => { if (!cancelled) setEnabled(Boolean(status?.enabled)); })
      .catch(() => { /* no assistant: leave the button hidden */ });
    setSpeakOn(readSpeakPref());
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open && !handsFree) inputRef.current?.focus();
  }, [open, handsFree]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.onended?.(); // settles a waiting speak() and frees the blob URL
  }, []);

  useEffect(() => stopAudio, [stopAudio]);

  /** Reads text aloud; resolves when playback ends, is stopped, or fails. */
  const speak = useCallback(async (text) => {
    stopAudio();
    let blob;
    try {
      blob = await speakText(text.slice(0, 2000));
    } catch {
      return; // reading aloud is a bonus; the text is already on screen
    }
    if (!speakOnRef.current && !handsFreeRef.current) return; // switched off meanwhile
    const audio = new Audio(URL.createObjectURL(blob));
    audioRef.current = audio;
    setSpeaking(true);
    await new Promise((resolve) => {
      audio.onended = () => {
        audio.onended = null;
        audio.onerror = null;
        if (audioRef.current === audio) audioRef.current = null;
        URL.revokeObjectURL(audio.src);
        setSpeaking(false);
        resolve();
      };
      audio.onerror = audio.onended;
      audio.play().catch(() => audio.onended?.());
    });
  }, [stopAudio]);

  const updateAction = (id, patch) => setMessages((prev) => prev.map((message) => (message.actions
    ? { ...message, actions: message.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)) }
    : message)));

  /** Sends a user turn and runs any navigation right away. Resolves with the reply, or null on failure. */
  const send = useCallback(async (text) => {
    const content = text.trim();
    if (!content) return null;
    const next = [...messagesRef.current, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setError(null);
    setBusy(true);
    try {
      const history = next
        .filter((message) => message.content)
        .slice(-HISTORY_LIMIT)
        .map(({ role, content: body }) => ({ role, content: body.slice(0, 4000) }));
      const { reply, actions = [] } = await sendAssistantMessage(history);
      const files = actions.filter((action) => action.type === 'attachment');
      const drafts = actions.filter((action) => action.type !== 'navigate' && action.type !== 'attachment');
      const answer = reply || (drafts.length ? 'Review the draft below.' : 'Sorry, I don\'t have an answer for that.');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: answer,
        files,
        actions: drafts.map((action) => ({ ...action, status: 'pending' })),
      }]);
      const destination = actions.find((action) => action.type === 'navigate');
      if (destination) {
        router.push(destination.href);
        // On a phone the sheet covers the page, so get out of the way (unless talking hands-free).
        if (!handsFreeRef.current && window.matchMedia?.('(max-width: 560px)').matches) setOpen(false);
      }
      return answer;
    } catch (err) {
      setError(normalizeApiError(err)?.message || 'The assistant could not answer. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [router]);

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
      // Recorded as an assistant turn so the model knows the change landed.
      setMessages((prev) => [...prev, { role: 'assistant', content: outcome }]);
      return outcome;
    } catch (err) {
      const message = (action.type === 'stage_change'
        ? friendlyTransitionError(err)
        : normalizeApiError(err))?.message || 'That didn\'t work. Try again.';
      updateAction(action.id, { status: 'pending', error: message });
      return message;
    }
  }, []);

  /**
   * Everything the user says or types lands here. "Confirm"/"cancel" answers
   * the waiting draft locally when there is exactly one, so a voice user never
   * has to click; anything else is a normal chat turn.
   * Resolves with text worth reading aloud, 'stop', or null.
   */
  const handleUtterance = useCallback(async (text) => {
    const command = matchVoiceCommand(text);
    if (command === 'stop') return 'stop';
    const waiting = messagesRef.current.flatMap((message) => message.actions || [])
      .filter((action) => action.status === 'pending');
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
    }
  }, []);

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

  const endHandsFree = useCallback(() => {
    handsFreeRef.current = false;
    setHandsFree(false);
    stopRecording();
    stopAudio();
  }, [stopAudio, stopRecording]);

  /** Listen, answer out loud, listen again: until the user ends it, says "stop", or goes quiet. */
  const startHandsFree = useCallback(async () => {
    handsFreeRef.current = true;
    setHandsFree(true);
    setError(null);
    stopAudio();
    while (handsFreeRef.current) {
      let blob;
      try {
        // Sequential on purpose: each turn waits for the previous answer.
        blob = await record({ autoStop: true });
      } catch (err) {
        setError(voiceErrorMessage(err));
        break;
      }
      if (!handsFreeRef.current) break;
      if (!blob) {
        setError('Hands-free ended because I didn\'t hear anything.');
        break;
      }
      const text = await transcribe(blob);
      if (text === null) break;
      if (!text || !handsFreeRef.current) continue;
      const answer = await handleUtterance(text);
      if (answer === 'stop' || answer === null) break;
      // Listening resumes only after playback ends, so the mic never hears the reply.
      if (handsFreeRef.current) await speak(answer);
    }
    endHandsFree();
  }, [endHandsFree, handleUtterance, record, speak, stopAudio, transcribe]);

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
    if (!next && !handsFreeRef.current) stopAudio();
    try {
      window.localStorage.setItem(SPEAK_KEY, next ? '1' : '0');
    } catch { /* storage blocked: preference lasts this visit */ }
  };

  const close = () => {
    endHandsFree();
    stopRecording();
    setOpen(false);
    window.setTimeout(() => fabRef.current?.focus(), 0);
  };

  if (!enabled) return null;

  if (!open) {
    return (
      <button
        ref={fabRef}
        type="button"
        className="assistant-fab"
        aria-label="Open assistant"
        title="Assistant (hold Space to talk)"
        onClick={() => setOpen(true)}
      >
        <Icon name="chat" size={22} aria-hidden="true" />
      </button>
    );
  }

  const voiceStatus = recording ? 'Listening…'
    : transcribing ? 'Transcribing…'
      : busy ? 'Thinking…'
        : speaking ? 'Speaking…'
          : 'Hands-free';
  const placeholder = recording ? 'Listening… just stop talking when you\'re done'
    : transcribing ? 'Transcribing…'
      : 'Ask about tickets, or say where to go';

  return (
    <section
      className="assistant-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-title"
      onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
    >
      <header className="assistant-head">
        <h2 id="assistant-title">Assistant</h2>
        <span className="spacer" />
        <button
          type="button"
          className="assistant-icon-btn"
          aria-pressed={handsFree}
          aria-label="Hands-free conversation"
          title={handsFree ? 'End hands-free' : 'Hands-free: talk back and forth without tapping'}
          disabled={!handsFree && (busy || transcribing || recording)}
          onClick={() => (handsFree ? endHandsFree() : startHandsFree())}
        >
          <Icon name="handsfree" size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="assistant-icon-btn"
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
          <div key={index} className={`assistant-msg is-${message.role}`}>
            <p><RichText text={message.content} /></p>
            {message.files?.length ? (
              <div className="assistant-files">
                {message.files.map((file) => <FileButton key={file.id} file={file} />)}
              </div>
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

      {handsFree ? (
        <div className="assistant-handsfree" role="status">
          <span className={`assistant-handsfree-dot${recording ? ' is-live' : ''}`} aria-hidden="true" />
          <span>{voiceStatus}</span>
          <span className="spacer" />
          <span className="assistant-handsfree-hint">Say &ldquo;stop&rdquo; to end</span>
          <button type="button" className="btn btn-sm" onClick={endHandsFree}>End</button>
        </div>
      ) : (
        <form
          className="assistant-compose"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) handleUtterance(input);
          }}
        >
          <button
            type="button"
            className={`assistant-icon-btn assistant-mic${recording ? ' is-recording' : ''}`}
            aria-pressed={recording}
            aria-label={recording ? 'Stop recording and send' : 'Speak your message'}
            title="Tap and speak; it sends when you stop talking"
            disabled={busy || transcribing}
            onClick={toggleMic}
          >
            <Icon name={recording ? 'stop' : 'mic'} size={18} aria-hidden="true" />
          </button>
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
      )}
    </section>
  );
}
