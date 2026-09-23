'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { stageLabel } from '@pms/shared';
import Icon from '../icons.jsx';
import {
  getAssistantStatus, sendAssistantMessage, speakText, transcribeAudio,
} from '@/shared/api/assistant.js';
import {
  createTicket, getTicket, patchTicket, transitionTicket,
} from '@/shared/api/tickets.js';
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

/** Applies a confirmed draft through the normal ticket API; returns what happened. */
async function applyAction(action) {
  if (action.type === 'create_ticket') {
    const ticket = await createTicket(action.body);
    return `Created ${ticket.ticketId}.`;
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

function ActionCard({ action, onConfirm, onDismiss }) {
  const { heading, rows } = describeAction(action);
  return (
    <div className={`assistant-action is-${action.status}`}>
      <p className="assistant-action-head">{heading}</p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {action.error ? <p className="assistant-action-error" role="alert">{action.error}</p> : null}
      {action.status === 'done' ? <p className="assistant-action-note">Done</p> : null}
      {action.status === 'dismissed' ? <p className="assistant-action-note">Cancelled</p> : null}
      {action.status === 'pending' || action.status === 'busy' ? (
        <div className="assistant-action-buttons">
          <button type="button" className="btn btn-sm btn-primary" disabled={action.status === 'busy'} onClick={onConfirm}>
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
      const drafts = actions.filter((action) => action.type !== 'navigate');
      const answer = reply || (drafts.length ? 'Review the draft below.' : 'Sorry, I don\'t have an answer for that.');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: answer,
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
            {message.actions?.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onConfirm={() => resolveDraft(action, true)}
                onDismiss={() => resolveDraft(action, false)}
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
