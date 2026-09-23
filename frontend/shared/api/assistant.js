import { apiFetch, apiFetchResponse } from './client.js';

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

/** @param {Blob} audio a MediaRecorder recording */
export function transcribeAudio(audio, options) {
  const formData = new FormData();
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
  formData.append('audio', audio, `voice.${ext}`);
  return apiFetch('/assistant/transcribe', { method: 'POST', formData, ...options });
}

/** @returns {Promise<Blob>} mp3 audio of `text` read aloud */
export async function speakText(text, options) {
  const response = await apiFetchResponse('/assistant/speech', { method: 'POST', body: { text }, ...options });
  return response.blob();
}
