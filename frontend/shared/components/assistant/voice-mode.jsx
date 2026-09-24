'use client';

import { useEffect, useRef } from 'react';
import Icon from '../icons.jsx';
import UsageMeter from './usage-meter.jsx';
import {
  AttachButton, FileDropZone, StagedFiles, fileDropProps,
} from './staged-files.jsx';

const PHASE_LABEL = {
  listening: 'Listening',
  transcribing: 'Got it…',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  idle: 'Starting…',
};

/** Loudness (RMS, ~0–0.3) to a 0–1 visual level; quiet speech still moves the orb. */
const toVisual = (rms) => Math.min(1, Math.sqrt(Math.max(0, rms) * 6));

/**
 * Writes a live audio level into a CSS variable on an element every frame,
 * eased so it doesn't jitter. `pickLevel()` returns the raw RMS to follow right
 * now (0 to rest). No React state, so 60 updates a second cost no re-renders.
 */
export function useLevelVar(elementRef, cssVar, pickLevel, active = true) {
  const pick = useRef(pickLevel);
  pick.current = pickLevel;
  useEffect(() => {
    if (!active) {
      elementRef.current?.style.setProperty(cssVar, '0');
      return undefined;
    }
    let frame = 0;
    let shown = 0;
    const tick = () => {
      shown += (toVisual(pick.current()) - shown) * 0.25;
      elementRef.current?.style.setProperty(cssVar, shown.toFixed(3));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [elementRef, cssVar, active]);
}

/**
 * Voice conversation docked in the corner where the assistant buttons live:
 * a living orb that swells with whoever is talking, plus a small caption card.
 * It never covers the page, so people keep working while they talk. The
 * conversation loop itself lives in the widget; this only shows it.
 */
/** Draft rows holding free text: shown full width and in full, not squeezed onto one line. */
const LONG_FIELDS = new Set(['Details', 'Comment', 'Description', 'Steps', 'Reason', 'About']);

export default function VoiceMode({
  phase, heard, reply, draft, draftReady, onConfirmDraft, onCancelDraft, onEditDraft,
  micLevel, outputLevel, onEnd, onShowChat, notice, usage, onUsageReset, onInterrupt,
  files = [], fileError = null, onAddFiles, onRemoveFile,
  draftFiles = null, draftFileError = null, onDraftFiles, onDraftRemoveFile,
  besidePanel = false, report = null, onShowReport, leaving = false, error = null,
}) {
  const orbRef = useRef(null);
  const endRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // The button that started voice mode is gone now; keep keyboard focus nearby.
  useEffect(() => {
    endRef.current?.focus();
  }, []);

  // Esc ends it from anywhere, since the dock doesn't hold focus.
  useEffect(() => {
    if (leaving) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onEnd(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEnd, leaving]);

  // While the assistant works or talks, the user can cut in (by speaking, or tapping the orb).
  const interruptible = phase === 'transcribing' || phase === 'thinking' || phase === 'speaking';

  // The orb follows whoever is talking: the mic while listening, the reply while speaking.
  useLevelVar(orbRef, '--vm-level', () => (phaseRef.current === 'listening' ? micLevel.current
    : phaseRef.current === 'speaking' ? outputLevel.current
      : 0));

  return (
    <section
      className={`voice-dock is-${phase}${besidePanel ? ' is-beside-panel' : ''}${leaving ? ' is-leaving' : ''}`}
      aria-label="Voice mode"
      // Ended and playing its exit: out of reach of clicks, focus and screen readers.
      inert={leaving}
      aria-hidden={leaving || undefined}
      {...(onAddFiles && !leaving ? fileDropProps(onAddFiles) : {})}
    >
      <div className="voice-card">
        <p className="voice-card-phase" role="status" aria-live="polite">
          <span className="voice-card-dot" aria-hidden="true" />
          {PHASE_LABEL[phase] || PHASE_LABEL.idle}
          {interruptible ? <span className="voice-card-cutin">· speak or tap the orb to interrupt</span> : null}
        </p>
        <div className="voice-card-captions" aria-live="polite">
          {heard ? <p className="voice-card-heard">&ldquo;{heard}&rdquo;</p> : null}
          {reply ? <p className="voice-card-reply">{reply}</p> : null}
          {!heard && !reply ? <p className="voice-card-heard">Ask about a ticket, or say where to go.</p> : null}
        </div>
        {/* What the app couldn't do, even though the reply may say it did. */}
        {error ? <p className="voice-draft-error" role="alert">{error}</p> : null}
        {report ? (
          <div className="voice-report" role="group" aria-label={report.title}>
            <p className="voice-report-title">{report.title}</p>
            <p className="voice-report-period">{report.period}</p>
            <div className="voice-draft-actions">
              {besidePanel ? null : (
                <button type="button" className="btn btn-sm" onClick={onShowReport}>Show report</button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={report.download}>
                <Icon name="download" size={14} aria-hidden="true" />
                Download
              </button>
            </div>
          </div>
        ) : null}
        {onRemoveFile ? <StagedFiles files={files} error={fileError} onRemove={onRemoveFile} /> : null}
        {files.length && !draft ? (
          <p className="voice-card-hint">Say which ticket to attach {files.length === 1 ? 'it' : 'them'} to.</p>
        ) : null}
        {draft ? (
          <div className="voice-draft" role="group" aria-label={`Draft: ${draft.heading}`}>
            <p className="voice-draft-head">{draft.heading}</p>
            <dl>
              {draft.rows.filter(([label]) => !(draftFiles && label === 'Files')).map(([label, value]) => (
                <div key={label} className={LONG_FIELDS.has(label) ? 'is-long' : undefined}>
                  <dt>{label}</dt>
                  <dd tabIndex={LONG_FIELDS.has(label) ? 0 : undefined}>{value}</dd>
                </div>
              ))}
            </dl>
            {draftFiles ? (
              <div className="voice-draft-files">
                <StagedFiles files={draftFiles} error={draftFileError} onRemove={onDraftRemoveFile} />
                <FileDropZone onAdd={onDraftFiles} disabled={draft.status === 'busy'} hasFiles={draftFiles.length > 0} />
              </div>
            ) : null}
            {draft.error ? <p className="voice-draft-error" role="alert">{draft.error}</p> : null}
            <div className="voice-draft-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={draft.status === 'busy' || !draftReady}
                onClick={onConfirmDraft}
              >
                {draft.status === 'busy' ? 'Working…' : 'Confirm'}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={draft.status === 'busy'} onClick={onCancelDraft}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm btn-ghost voice-draft-edit" disabled={draft.status === 'busy'} onClick={onEditDraft}>
                Edit in chat
              </button>
            </div>
            <p className="voice-draft-hint">Or say &ldquo;confirm&rdquo; or &ldquo;cancel&rdquo;.</p>
          </div>
        ) : null}
        <div className="voice-card-actions">
          <UsageMeter usage={usage} onReset={onUsageReset} />
          <span className="voice-card-notice" title={notice}>AI · processed by OpenAI</span>
          {onAddFiles ? <AttachButton className="voice-card-btn" onAdd={onAddFiles} /> : null}
          <button type="button" className="voice-card-btn" onClick={onShowChat} aria-label="Show chat" title="Continue in chat">
            <Icon name="chat" size={16} aria-hidden="true" />
          </button>
          <button
            ref={endRef}
            type="button"
            className="voice-card-btn is-end"
            onClick={onEnd}
            aria-label="End voice mode"
            title="End (Esc, or say “stop”)"
          >
            <Icon name="x" size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <button
        type="button"
        className="voice-orb"
        ref={orbRef}
        disabled={!interruptible}
        aria-label="Interrupt the assistant"
        title={interruptible ? 'Tap to interrupt' : undefined}
        onClick={onInterrupt}
      >
        <span className="voice-orb-halo" />
        <span className="voice-orb-body">
          <span className="voice-orb-cloud is-a" />
          <span className="voice-orb-cloud is-b" />
        </span>
      </button>
    </section>
  );
}
