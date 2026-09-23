import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';

const BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 45_000;

// ponytail: plain fetch, no SDK. Three endpoints don't justify a dependency;
// switch to the `openai` package if we need streaming or its retry logic.
async function call(config, path, init) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.assistant.apiKey}`, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn('assistant: OpenAI request failed', { path, error: err.message });
    throw new ApiError(502, 'ASSISTANT_UPSTREAM', 'The assistant is unavailable right now. Try again shortly.');
  }
  if (!res.ok) {
    // Log the provider's message server-side only; the client gets a stable code.
    const detail = await res.text().catch(() => '');
    logger.warn('assistant: OpenAI error', { path, status: res.status, detail: detail.slice(0, 500) });
    if (res.status === 429) {
      throw new ApiError(503, 'ASSISTANT_BUSY', 'The assistant is busy. Try again in a moment.');
    }
    throw new ApiError(502, 'ASSISTANT_UPSTREAM', 'The assistant is unavailable right now. Try again shortly.');
  }
  return res;
}

/** One Responses API turn. `input` is the running item list (messages, calls, outputs). */
export async function createResponse(config, { instructions, input, tools }) {
  const res = await call(config, '/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.assistant.chatModel,
      instructions,
      input,
      tools,
      // Nothing is kept on OpenAI's side; reasoning state rides along encrypted instead.
      store: false,
      include: ['reasoning.encrypted_content'],
    }),
  });
  return res.json();
}

/**
 * Our users speak English, Hindi or Hinglish. Left to guess, the model often
 * hears Hindi/Hinglish as Urdu and writes Arabic script, which then drags the
 * chat reply into Arabic. The prompt steers it; the script check catches a miss.
 */
const LANGUAGE_HINT = 'The speaker talks about software tickets and projects in English, Hindi, '
  + 'or Hinglish (Hindi mixed with English). Transcribe English and Hinglish in Latin script and Hindi in Devanagari.';
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

async function transcribeOnce(config, audio, language) {
  const form = new FormData();
  form.append('file', new Blob([audio.buffer], { type: audio.mimetype }), audio.originalname || 'audio.webm');
  form.append('model', config.assistant.transcribeModel);
  form.append('prompt', LANGUAGE_HINT);
  if (language) form.append('language', language);
  const res = await call(config, '/audio/transcriptions', { method: 'POST', body: form });
  const data = await res.json();
  return String(data.text || '').trim();
}

/** Speech to text. `audio` is a multer file (buffer + mimetype). */
export async function transcribe(config, audio) {
  const text = await transcribeOnce(config, audio);
  // Arabic script here means Hindi/Hinglish misheard as Urdu: redo it as Hindi.
  return ARABIC_SCRIPT.test(text) ? transcribeOnce(config, audio, 'hi') : text;
}

/** Text to speech; returns an mp3 Buffer. */
export async function speak(config, text) {
  const res = await call(config, '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.assistant.speechModel,
      voice: config.assistant.speechVoice,
      input: text,
      response_format: 'mp3',
    }),
  });
  return Buffer.from(await res.arrayBuffer());
}
