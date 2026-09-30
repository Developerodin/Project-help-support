import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * The voice conversation loop end to end, with a scripted microphone: each
 * record() call hands back the next queued recording (null = silence, which
 * ends voice mode), and nobody ever talks over the assistant.
 */

const recordings = [];
// Stable across renders, like the real hook's useCallback'd functions.
const recorder = {
  recording: false,
  record: async () => recordings.shift() ?? null,
  stop: () => {},
  level: { current: 0 },
};
vi.mock('./use-voice-recorder.js', () => ({
  useVoiceRecorder: () => recorder,
  watchForSpeech: () => ({ done: new Promise(() => {}), cancel: vi.fn() }),
  voiceErrorMessage: () => 'mic error',
}));

const getAssistantStatus = vi.fn();
const sendAssistantMessage = vi.fn();
const transcribeAudio = vi.fn();
const speakText = vi.fn(async () => new Response(new Blob(['mp3'])));
vi.mock('@/shared/api/assistant.js', () => ({
  getAssistantStatus: (...args) => getAssistantStatus(...args),
  sendAssistantMessage: (...args) => sendAssistantMessage(...args),
  transcribeAudio: (...args) => transcribeAudio(...args),
  speakText: (...args) => speakText(...args),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/shared/contexts/auth-context.jsx', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({ activeProject: null, setActiveProjectId: () => {} }),
}));

const { default: AssistantWidget } = await import('./assistant-widget.jsx');

const apiError = (status, code, message) => Object.assign(new Error(message), { status, code });

describe('voice mode loop', () => {
  beforeEach(() => {
    recordings.length = 0;
    [getAssistantStatus, sendAssistantMessage, transcribeAudio].forEach((fn) => fn.mockReset());
    window.sessionStorage.clear();
    getAssistantStatus.mockResolvedValue({ enabled: true });
    URL.createObjectURL = vi.fn(() => 'blob:reply');
    URL.revokeObjectURL = vi.fn();
    // jsdom can't play audio; make a reply "finish" as soon as it starts.
    window.HTMLMediaElement.prototype.play = function play() {
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = () => {};
    window.HTMLMediaElement.prototype.load = () => {};
  });

  it('a busy server on one turn does not end voice mode; the next turn is answered', async () => {
    recordings.push(new Blob(['a']), new Blob(['b']));
    transcribeAudio.mockResolvedValueOnce({ text: 'open the tickets page' }).mockResolvedValueOnce({ text: 'open the tickets page' });
    sendAssistantMessage
      .mockRejectedValueOnce(apiError(409, 'ASSISTANT_BUSY', 'Still answering your last message.'))
      .mockResolvedValueOnce({ reply: 'Opened Tickets.', actions: [] });

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice mode' }));

    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledTimes(2));
    expect(sendAssistantMessage.mock.calls[1][1].mode).toBe('voice');
    // Only the silence after the second turn ends it.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Voice mode' })).toBeNull());
    expect(screen.getByRole('alert').textContent).toMatch(/didn't hear anything/);
  });

  it('a Hinglish reply is voiced whole, in the Hindi voice', async () => {
    recordings.push(new Blob(['a']));
    transcribeAudio.mockResolvedValue({ text: 'TES4-3 ka status kya hai?' });
    sendAssistantMessage.mockResolvedValue({
      reply: 'TES4-3 abhi Under Review mein hai. Team lead ka review baaki hai, uske baad aage jayega.', actions: [],
    });
    speakText.mockClear();
    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice mode' }));
    await waitFor(() => expect(speakText).toHaveBeenCalledTimes(1));
    expect(speakText.mock.calls[0][0]).toMatch(/^TES4-3 abhi .* aage jayega\.$/);
    expect(speakText.mock.calls[0][1].language).toBe('hi');
  });

  it('a spent daily allowance ends voice mode and says why', async () => {
    recordings.push(new Blob(['a']), new Blob(['b']));
    transcribeAudio.mockResolvedValue({ text: 'what is overdue' });
    sendAssistantMessage.mockRejectedValue(apiError(429, 'ASSISTANT_DAILY_LIMIT', 'You have used today’s ₹100 assistant allowance.'));

    render(<AssistantWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice mode' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Voice mode' })).toBeNull());
    expect(sendAssistantMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toMatch(/₹100 assistant allowance/);
  });
});
