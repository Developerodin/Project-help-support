import { ApiClientError, apiFetch, apiFetchResponse } from './client.js';

/** { enabled } — false when the server has no OpenAI key; the UI then hides the chat. */
export const getAssistantStatus = (options) => apiFetch('/assistant', options);

/**
 * @param {{ role: 'user'|'assistant', content: string }[]} messages
 * @param {{ mode?: 'voice', page?: { path: string, ticketId: string|null, tab: string|null } }} [options]
 *   mode 'voice' asks for replies suited to being heard; page is where the user is
 */
export const sendAssistantMessage = (messages, { mode, page, ...options } = {}) => apiFetch('/assistant/chat', {
  method: 'POST',
  body: { messages, ...(mode ? { mode } : {}), ...(page ? { page } : {}) },
  ...options,
});

/**
 * The same as sendAssistantMessage, but the reply's text arrives as it is
 * written: `onText` gets the text so far each time more comes, and '' when the
 * server drops what it showed (it led into a lookup). Resolves with what
 * sendAssistantMessage resolves with, whose reply is the final word.
 */
export async function streamAssistantMessage(messages, {
  mode, page, onText, ...options
} = {}) {
  const response = await apiFetchResponse('/assistant/chat', {
    method: 'POST',
    body: {
      messages, stream: true, ...(mode ? { mode } : {}), ...(page ? { page } : {}),
    },
    ...options,
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'delta') {
        text += event.text;
        onText?.(text);
      } else if (event.type === 'reset') {
        text = '';
        onText?.('');
      } else if (event.type === 'done') {
        return { reply: event.reply, actions: event.actions, sig: event.sig };
      } else if (event.type === 'error') {
        throw new ApiClientError({ status: 500, ...event.error });
      }
    }
    if (done) throw new ApiClientError({ status: 502, code: 'ASSISTANT_STREAM_ENDED', message: 'The assistant stopped answering. Try again.' });
  }
}

/** @param {Blob} audio a MediaRecorder recording */
export function transcribeAudio(audio, options) {
  const formData = new FormData();
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
  formData.append('audio', audio, `voice.${ext}`);
  return apiFetch('/assistant/transcribe', { method: 'POST', formData, ...options });
}

/** @returns {Promise<Response>} mp3 of `text` read aloud; its body streams in as it is synthesised */
export const speakText = (text, { language, ...options } = {}) => apiFetchResponse('/assistant/speech', {
  method: 'POST', body: { text, ...(language ? { language } : {}) }, ...options,
});

/**
 * A signed summary of the chat, to start a new one with its context.
 * @param {{ role: 'user'|'assistant', content: string, sig?: string, notes?: string[] }[]} messages
 * @returns {Promise<{ summary: string, sig: string }>}
 */
export const summarizeAssistantChat = (messages, options) => apiFetch('/assistant/summarize', {
  method: 'POST', body: { messages }, ...options,
});
