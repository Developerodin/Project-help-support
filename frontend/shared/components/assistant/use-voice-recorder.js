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

  const stop = useCallback(() => {
    if (active.current?.state === 'recording') active.current.stop();
  }, []);

  const record = useCallback(async ({ autoStop = false } = {}) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new VoiceError('unsupported');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        active.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        resolve(heard && blob.size >= MIN_BYTES ? blob : null);
      };

      if (autoStop && AudioCtx) {
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
          const now = Date.now();
          if (Math.sqrt(sum / samples.length) > SPEECH_LEVEL) {
            heard = true;
            lastSpeech = now;
          }
          const done = heard ? now - lastSpeech > END_SILENCE_MS : now - started > NO_SPEECH_MS;
          if (done && recorder.state === 'recording') recorder.stop();
        }, 100);
      }

      active.current = recorder;
      recorder.start();
      setRecording(true);
    });
  }, []);

  // Never leave the mic open after the widget unmounts.
  useEffect(() => stop, [stop]);

  return { recording, record, stop };
}
