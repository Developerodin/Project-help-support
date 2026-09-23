'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { stageLabel } from '@pms/shared';
import Icon from '../icons.jsx';
import {
  getAssistantStatus, sendAssistantMessage, speakText, transcribeAudio,
} from '@/shared/api/assistant.js';
import {
  createTicket, getTicket, patchTicket, transitionTicket,
} from '@/shared/api/tickets.js';
import { friendlyTransitionError, normalizeApiError } from '@/shared/lib/api-error.js';

/** Turns sent per request; the server caps at 30. */
const HISTORY_LIMIT = 20;
const MAX_RECORDING_MS = 60_000;
const SPEAK_KEY = 'assistant.speak';
const TICKET_ID = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const SUGGESTIONS = ['What is overdue right now?', 'Show my open tickets', 'How do I move a ticket to QA?'];

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

function readSpeakPref() {
  try {
    return window.localStorage.getItem(SPEAK_KEY) === '1';
  } catch {
    return false;
  }
}

export default function AssistantWidget() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const speakOnRef = useRef(speakOn);
  speakOnRef.current = speakOn;
  const recorderRef = useRef(null);
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
    if (open) inputRef.current?.focus();
  }, [open]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audioRef.current = null;
  }, []);

  // Release the mic and any playing reply when the widget goes away.
  useEffect(() => () => {
    recorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
    stopAudio();
  }, [stopAudio]);

  const play = useCallback(async (text) => {
    stopAudio();
    try {
      const blob = await speakText(text.slice(0, 2000));
      if (!speakOnRef.current) return; // turned off while the audio was generating
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = stopAudio;
      audioRef.current = audio;
      await audio.play();
    } catch {
      // Reading aloud is a bonus; the text reply is already on screen.
    }
  }, [stopAudio]);

  const send = useCallback(async (text) => {
    const content = text.trim();
    if (!content) return;
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
      const fallback = actions.length ? 'Review the draft below.' : 'Sorry, I don\'t have an answer for that.';
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: reply || fallback,
        actions: actions.map((action) => ({ ...action, status: 'pending' })),
      }]);
      if (speakOnRef.current && reply) play(reply);
    } catch (err) {
      setError(normalizeApiError(err)?.message || 'The assistant could not answer. Try again.');
    } finally {
      setBusy(false);
    }
  }, [play]);

  const updateAction = (id, patch) => setMessages((prev) => prev.map((message) => (message.actions
    ? { ...message, actions: message.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)) }
    : message)));

  const confirmAction = async (action) => {
    updateAction(action.id, { status: 'busy', error: null });
    try {
      const outcome = await applyAction(action);
      updateAction(action.id, { status: 'done' });
      // Recorded as an assistant turn so the model knows the change landed.
      setMessages((prev) => [...prev, { role: 'assistant', content: outcome }]);
    } catch (err) {
      const message = (action.type === 'stage_change'
        ? friendlyTransitionError(err)
        : normalizeApiError(err))?.message;
      updateAction(action.id, { status: 'pending', error: message || 'That didn\'t work. Try again.' });
    }
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice input isn\'t supported in this browser.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is blocked. Allow it in your browser settings to talk to the assistant.');
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find((type) => MediaRecorder.isTypeSupported?.(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const limit = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_RECORDING_MS);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1000) return; // a tap, not speech
      setTranscribing(true);
      try {
        const { text } = await transcribeAudio(blob);
        if (text) send(text);
        else setError('I didn\'t catch that. Try again.');
      } catch (err) {
        setError(normalizeApiError(err)?.message || 'Could not understand the recording.');
      } finally {
        setTranscribing(false);
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  };

  const toggleRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else startRecording();
  };

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOn(next);
    if (!next) stopAudio();
    try {
      window.localStorage.setItem(SPEAK_KEY, next ? '1' : '0');
    } catch { /* storage blocked: preference lasts this visit */ }
  };

  const close = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    stopAudio();
    setOpen(false);
    window.setTimeout(() => fabRef.current?.focus(), 0);
  };

  if (!enabled) return null;

  if (!open) {
    return (
      <button ref={fabRef} type="button" className="assistant-fab" aria-label="Open assistant" onClick={() => setOpen(true)}>
        <Icon name="chat" size={22} aria-hidden="true" />
      </button>
    );
  }

  const placeholder = recording ? 'Listening… tap stop when you\'re done'
    : transcribing ? 'Transcribing…'
      : 'Ask about tickets, or how something works';

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
            <p>Ask about your tickets, file a new one, or ask how something works. Tap the mic to talk.</p>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" className="btn btn-sm" onClick={() => send(suggestion)}>
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
                onConfirm={() => confirmAction(action)}
                onDismiss={() => updateAction(action.id, { status: 'dismissed', error: null })}
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

      <form
        className="assistant-compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) send(input);
        }}
      >
        <button
          type="button"
          className={`assistant-icon-btn assistant-mic${recording ? ' is-recording' : ''}`}
          aria-pressed={recording}
          aria-label={recording ? 'Stop recording and send' : 'Speak your message'}
          disabled={busy || transcribing}
          onClick={toggleRecording}
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
              if (!busy) send(input);
            }
          }}
        />
        <button type="submit" className="assistant-icon-btn assistant-send" aria-label="Send" disabled={busy || !input.trim()}>
          <Icon name="send" size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
