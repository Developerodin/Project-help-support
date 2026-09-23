import { speechLanguage } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';

const BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 45_000;

// ponytail: plain fetch, no SDK. Three endpoints don't justify a dependency;
// switch to the `openai` package if we need streaming or its retry logic.
async function call(config, path, { signal, ...init }) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.assistant.apiKey}`, ...init.headers },
      // Our timeout, or the caller cancelling (the user interrupted or left).
      signal: signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (signal?.aborted) throw new ApiError(499, 'ASSISTANT_CANCELLED', 'The request was cancelled.');
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
export async function createResponse(config, {
  instructions, input, tools, signal, toolChoice,
}) {
  const res = await call(config, '/responses', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.assistant.chatModel,
      instructions,
      input,
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
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
/** Shows the transcriber the style we want: code-switched, Latin script, untranslated. */
const HINGLISH_EXAMPLE = 'TES4-2 ka status kya hai? Isko Under Review mein move kar do, aur ek comment add karo ki testing ho gayi.';
const LANGUAGE_HINT = 'A person talks about software tickets and projects in English, Hindi, or Hinglish, often '
  + 'switching language mid-sentence. Write exactly what they say, word for word, and never translate. English and '
  + `Hinglish go in Latin script, like: "${HINGLISH_EXAMPLE}" Only a fully Hindi sentence goes in Devanagari.`;
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

/** Words of the app itself, so "discussion" isn't heard as "registration". */
const APP_WORDS = 'Discussion, Details, Attachments, History, QA report, Board, Tickets, UI & QA, comment, reply.';

/**
 * Project keys and names the speaker may say, so "TES4" isn't heard as "TS4".
 * A plain word list, not instructions: the transcriber sometimes echoes its
 * prompt on near-silent audio, and a list is easy to recognise and drop.
 */
function vocabularyHint(vocabulary) {
  const projects = (vocabulary || []).slice(0, 40).map((project) => `${project.key} (${project.name}), ${project.key}-2`);
  return ` ${[APP_WORDS, ...projects].join('; ')}`;
}

const normalise = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * True when the "transcript" is really a piece of our own prompt, which the
 * model produces for silence or noise. Real speech is never a verbatim chunk of it.
 */
export function isPromptEcho(text, prompt) {
  const said = normalise(text);
  if (said.split(' ').length < 4) return false; // "Board", "TES4-2": short real answers
  // The example is made of things people really say ("isko Under Review mein move
  // kar do"), so only the example word for word counts as an echo of it.
  if (said === normalise(HINGLISH_EXAMPLE)) return true;
  return normalise(prompt.replace(HINGLISH_EXAMPLE, ' ')).includes(said);
}

async function transcribeOnce(config, audio, language, vocabulary) {
  const prompt = LANGUAGE_HINT + vocabularyHint(vocabulary);
  const form = new FormData();
  form.append('file', new Blob([audio.buffer], { type: audio.mimetype }), audio.originalname || 'audio.webm');
  form.append('model', config.assistant.transcribeModel);
  form.append('prompt', prompt);
  if (language) form.append('language', language);
  const res = await call(config, '/audio/transcriptions', { method: 'POST', body: form });
  const data = await res.json();
  const text = String(data.text || '').trim();
  // An echoed prompt is not something the user said: treat it as silence.
  return isPromptEcho(text, prompt) ? '' : text;
}

/**
 * Speech to text. `audio` is a multer file (buffer + mimetype). `attempts` is
 * how many times the clip was sent (each is billed), for the spend cap.
 */
export async function transcribe(config, audio, { vocabulary } = {}) {
  const text = await transcribeOnce(config, audio, undefined, vocabulary);
  // Arabic script here means Hindi/Hinglish misheard as Urdu: redo it as Hindi.
  if (!ARABIC_SCRIPT.test(text)) return { text, attempts: 1 };
  return { text: await transcribeOnce(config, audio, 'hi', vocabulary), attempts: 2 };
}

/**
 * How the voice should sound, the same for every clip of a reply (it is voiced
 * in two parts; without this each part can come out at its own pace and pitch).
 */
const STEADY = 'Speak in a calm, steady, friendly tone at an even, moderate pace and a constant volume, like a '
  + 'helpful teammate. No dramatic emphasis, no sudden pitch changes, no rushing at the end. Read ticket ids like '
  + 'TES4-2 letter by letter: "T E S 4 dash 2".';

/** Each language gets its own voice and accent. */
const VOICE_STYLE = {
  en: `${STEADY} Use a clear, neutral English accent.`,
  hi: `${STEADY} Speak as a native Hindi speaker from North India, with a natural Hindi accent and intonation. `
    + 'For Hinglish, keep the English words in the flow the way people in India say them, not with a foreign accent.',
};

/**
 * Text to speech; returns an mp3 Buffer. `language` ('hi' or 'en') picks the
 * voice and accent; decide it once per reply so its parts sound alike.
 */
export async function speak(config, text, { language = speechLanguage(text) } = {}) {
  const lang = language === 'hi' ? 'hi' : 'en';
  const voice = lang === 'hi' ? config.assistant.speechVoiceHindi || config.assistant.speechVoice : config.assistant.speechVoice;
  const res = await call(config, '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.assistant.speechModel,
      voice,
      input: text,
      // Only the gpt-4o speech models take style instructions; tts-1 would reject them.
      ...(/^gpt-4o/.test(config.assistant.speechModel) ? { instructions: VOICE_STYLE[lang] } : {}),
      response_format: 'mp3',
    }),
  });
  return Buffer.from(await res.arrayBuffer());
}
