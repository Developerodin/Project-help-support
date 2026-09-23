'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_MS = 60_000;
/** Silence after speech that ends a turn. Long enough for a breath between phrases. */
const END_SILENCE_MS = 1200;
/** No speech at all for this long ends the recording with nothing. */
const NO_SPEECH_MS = 8000;
/** RMS level treated as speech. ponytail: fixed threshold; a noisy room may need calibration. */
const SPEECH_LEVEL = 0.02;
const MIN_BYTES = 1000;

export class VoiceError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason; // 'unsupported' | 'blocked'
  }
}

export function voiceErrorMessage(error) {
  if (error?.reason === 'unsupported') return 'Voice isn\'t supported in this browser.';
  if (error?.reason === 'blocked') {
    return 'Microphone access is blocked. Allow it in your browser settings to talk to the assistant.';
  }
  return 'The microphone stopped unexpectedly. Try again.';
}

/**
 * Echo cancellation keeps the assistant's own voice (from the speakers) out of
 * the mic, which is what lets people talk over it without it hearing itself.
 */
const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

/** Speech has to be louder than this, for this long, to count as an interruption. */
const BARGE_IN_LEVEL = 0.05;
const BARGE_IN_HOLD_MS = 300;
/** Ignore the mic's first moments: opening it can click. */
const BARGE_IN_WARMUP_MS = 400;

/**
 * Listens (without recording) for the user starting to speak, so they can
 * interrupt while the assistant thinks or talks. `done` resolves on sustained
 * speech; `cancel()` releases the mic. If the mic can't open, `done` simply
 * never resolves.
 * ponytail: a fixed level. Loud speakers without echo cancellation, or a noisy
 * room, can trigger it; raise BARGE_IN_LEVEL if interruptions fire on their own.
 */
export function watchForSpeech() {
  let cancelled = false;
  let cleanup = () => {};
  const done = new Promise((resolve) => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioCtx) return;
    navigator.mediaDevices.getUserMedia(MIC).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioCtx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const started = Date.now();
      let loudSince = null;
      const poll = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const now = Date.now();
        if (now - started < BARGE_IN_WARMUP_MS) return;
        if (Math.sqrt(sum / samples.length) > BARGE_IN_LEVEL) {
          loudSince ??= now;
          if (now - loudSince >= BARGE_IN_HOLD_MS) resolve();
        } else {
          loudSince = null;
        }
      }, 50);
      cleanup = () => {
        window.clearInterval(poll);
        context.close().catch(() => {});
        stream.getTracks().forEach((track) => track.stop());
      };
    }).catch(() => { /* no mic: nothing to listen for */ });
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      cleanup();
    },
  };
}

function pickMimeType() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((type) => MediaRecorder.isTypeSupported?.(type));
}

/**
 * One recording at a time. `record({ autoStop })` resolves with the audio Blob,
 * or null when nothing was said. With autoStop it ends itself once the speaker
 * goes quiet; without it, it runs until `stop()` (push-to-talk, max 60s).
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const active = useRef(null);
  // stop() can arrive while the mic is still starting (a quick key release);
  // remember it so the recording ends as soon as it begins.
  const stopRequested = useRef(false);
  /** Current mic loudness (RMS, roughly 0–0.3), for visuals. A ref so reading it never re-renders. */
  const level = useRef(0);

  const stop = useCallback(() => {
    if (active.current?.state === 'recording') active.current.stop();
    else stopRequested.current = true;
  }, []);

  const record = useCallback(async ({ autoStop = false } = {}) => {
    stopRequested.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new VoiceError('unsupported');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC);
    } catch {
      throw new VoiceError('blocked');
    }

    return new Promise((resolve) => {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      // Without an analyser there is no way to hear silence, so treat it as heard.
      let heard = !autoStop || !AudioCtx;
      let audioContext = null;
      let poll = null;
      const cap = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_MS);

      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        window.clearTimeout(cap);
        window.clearInterval(poll);
        audioContext?.close().catch(() => {});
        stream.getTracks().forEach((track) => track.stop());
        level.current = 0;
        active.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        resolve(heard && blob.size >= MIN_BYTES ? blob : null);
      };

      // The analyser serves two jobs: a live loudness for visuals (level), and,
      // with autoStop, hearing when the speaker has finished.
      if (AudioCtx) {
        audioContext = new AudioCtx();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const started = Date.now();
        let lastSpeech = started;
        poll = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          const rms = Math.sqrt(sum / samples.length);
          level.current = rms;
          if (!autoStop) return;
          const now = Date.now();
          if (rms > SPEECH_LEVEL) {
            heard = true;
            lastSpeech = now;
          }
          const done = heard ? now - lastSpeech > END_SILENCE_MS : now - started > NO_SPEECH_MS;
          if (done && recorder.state === 'recording') recorder.stop();
        }, 50);
      }

      active.current = recorder;
      recorder.start();
      setRecording(true);
      if (stopRequested.current) recorder.stop();
    });
  }, []);

  // Never leave the mic open after the widget unmounts.
  useEffect(() => stop, [stop]);

  return {
    recording, record, stop, level,
  };
}
