import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVoiceRecorder, voiceErrorMessage, watchForSpeech } from './use-voice-recorder.js';

// A fake microphone: `level` is the loudness the analyser reports on each poll.
let level = 0;
const track = { stop: vi.fn() };

class FakeRecorder {
  static isTypeSupported = () => true;

  constructor() {
    this.state = 'inactive';
    this.mimeType = 'audio/webm';
  }

  start() { this.state = 'recording'; }

  stop() {
    this.state = 'inactive';
    this.ondataavailable({ data: new Blob([new Uint8Array(2000)]) });
    this.onstop();
  }
}

class FakeAudioContext {
  createAnalyser() {
    return { fftSize: 0, getFloatTimeDomainData: (samples) => samples.fill(level) };
  }

  createMediaStreamSource() { return { connect: () => {} }; }

  close() { return Promise.resolve(); }
}

beforeEach(() => {
  vi.useFakeTimers();
  level = 0;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Starts a recording and lets the mic permission resolve; returns the pending result in a box. */
async function begin(result, options) {
  const box = {};
  await act(async () => {
    box.pending = result.current.record(options);
    await Promise.resolve();
    await Promise.resolve();
  });
  return box;
}

describe('useVoiceRecorder', () => {
  it('ends the turn by itself after speech followed by a pause', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    const { pending } = await begin(result, { autoStop: true });

    level = 0.2; // talking
    await act(async () => { vi.advanceTimersByTime(800); });
    expect(result.current.recording).toBe(true);
    level = 0; // quiet: a thinking pause mid-sentence must not end the turn
    await act(async () => { vi.advanceTimersByTime(1300); });
    expect(result.current.recording).toBe(true);
    await act(async () => { vi.advanceTimersByTime(600); });

    expect(await pending).toBeInstanceOf(Blob);
    expect(result.current.recording).toBe(false);
    expect(track.stop).toHaveBeenCalled();
  });

  it('gives up with nothing when no one speaks', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    const { pending } = await begin(result, { autoStop: true });
    await act(async () => { vi.advanceTimersByTime(8500); });
    expect(await pending).toBeNull();
  });

  it('push-to-talk keeps recording through silence until stop()', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    const { pending } = await begin(result, { autoStop: false });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(result.current.recording).toBe(true);
    act(() => result.current.stop());
    expect(await pending).toBeInstanceOf(Blob);
  });

  it('a stop() that arrives while the mic is still starting ends the recording at once', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    let pending;
    await act(async () => {
      pending = result.current.record({ autoStop: false });
      result.current.stop(); // released before getUserMedia resolved
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.recording).toBe(false);
    expect(await pending).toBeInstanceOf(Blob);
  });

  it('watchForSpeech ignores the mic warming up and short noises, then fires on sustained speech', async () => {
    const cutIn = watchForSpeech();
    let fired = false;
    cutIn.done.then(() => { fired = true; });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    level = 0.2; // loud, but during the mic's warm-up
    await act(async () => { vi.advanceTimersByTime(350); });
    level = 0;
    await act(async () => { vi.advanceTimersByTime(200); });
    level = 0.2; // a short blip
    await act(async () => { vi.advanceTimersByTime(150); });
    level = 0;
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(fired).toBe(false);

    level = 0.2; // real speech
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(fired).toBe(true);
    cutIn.cancel();
    expect(track.stop).toHaveBeenCalled();
  });

  it('watchForSpeech stays quiet with the assistant’s own voice below the level', async () => {
    const cutIn = watchForSpeech();
    let fired = false;
    cutIn.done.then(() => { fired = true; });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    level = 0.03; // echo that leaks past cancellation stays under the barge-in level
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(fired).toBe(false);
    cutIn.cancel();
  });
});

describe('voice on a plain-http page', () => {
  it('says the connection is the problem, not the browser', async () => {
    vi.stubGlobal('isSecureContext', false);
    const saved = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { result } = renderHook(() => useVoiceRecorder());
    const error = await result.current.record().catch((err) => err);
    expect(voiceErrorMessage(error)).toMatch(/secure connection/);
    Object.defineProperty(navigator, 'mediaDevices', { value: saved, configurable: true });
    vi.unstubAllGlobals();
  });
});
