import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import Joi from 'joi';
import multer from 'multer';
import { can } from '@pms/shared';
import { auth } from '../../platform/auth.js';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';
import { MongoRateLimitStore, makeLimiter } from '../../platform/rateLimit.js';
import { validate } from '../../platform/validate.js';
import { chat, summarize } from './assistant.service.js';
import { TICKET_TABS, projectRoster } from './assistant.tools.js';
import {
  checkAllowance, estimateAudioSeconds, getAllowance, isRecentReply, recentNames, recordUsage, rememberReply,
  signReply, signedHistory, withChatLock,
} from './assistant.guard.js';
import { namesIn, safePage, speechAllowed } from './assistant.scope.js';
import { speak, transcribe } from './openai.client.js';

const MINUTE = 60 * 1000;
/** ~60s of browser-recorded opus is well under 1MB; 5MB leaves room for wav. */
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const chatSchema = {
  body: Joi.object({
    messages: Joi.array().min(1).max(30).items(Joi.object({
      role: Joi.string().valid('user', 'assistant').required(),
      content: Joi.string().trim().min(1).max(4000).required(),
      // The server's signature on an assistant reply; replies without a valid one are dropped (signedHistory).
      sig: Joi.string().hex().length(64),
      // The widget's notes under a reply (drafts, reports, outcomes).
      notes: Joi.array().max(20).items(Joi.string().max(2000)),
    })).required(),
    // 'voice' when the user is talking in voice mode, so replies suit being heard.
    mode: Joi.string().valid('chat', 'voice').default('chat'),
    // Answer as newline-delimited JSON events, the reply's text arriving as it is written.
    stream: Joi.boolean().default(false),
    // Where the user is right now, so "this ticket" and "the details tab" mean something.
    page: Joi.object({
      path: Joi.string().max(200).pattern(/^\/[\w\-/]*$/).required(),
      ticketId: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/).allow(null),
      tab: Joi.string().valid(...TICKET_TABS).allow(null),
      // The project picked in the switcher (null = all projects).
      project: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9]{1,9}$/).allow(null),
      // The address's query string: the page's filters, view and page number.
      query: Joi.string().max(1000).pattern(/^(\?.*)?$/).allow(''),
    }),
  }),
};

/** A whole chat to summarise: the same message shape as chat, up to everything the widget keeps. */
const summarySchema = {
  body: Joi.object({ messages: chatSchema.body.extract('messages').max(40) }),
};

const speechSchema = {
  body: Joi.object({
    text: Joi.string().trim().min(1).max(2000).required(),
    // The reply's language, decided once for the whole reply so its parts share a voice.
    language: Joi.string().valid('hi', 'en'),
  }),
};

/**
 * Audio formats browsers record (webm/ogg opus, Safari mp4) plus wav/mp3,
 * checked by magic bytes rather than the client-supplied mimetype.
 */
export function isAudio(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const ascii = (start, end) => buffer.subarray(start, end).toString('latin1');
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true; // webm
  if (ascii(0, 4) === 'OggS') return true;
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return true;
  if (ascii(4, 8) === 'ftyp') return true; // mp4 / m4a
  if (ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return true; // mp3
  return false;
}

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
}).single('audio');

/** Whether this user's role (or a per-user override) grants the assistant. */
const mayUseAssistant = (req) => can(req.user, 'assistant.use', req.permissionContext);

function requireAssistant(config) {
  return (req, _res, next) => {
    if (!config.assistant) return next(new ApiError(503, 'ASSISTANT_DISABLED', 'The assistant is not configured.'));
    if (!mayUseAssistant(req)) {
      return next(new ApiError(403, 'ASSISTANT_NOT_ALLOWED', 'The assistant is not enabled for your role.'));
    }
    return next();
  };
}

export default function assistantRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  // Tells the UI whether to show the assistant at all, and today's allowance for the usage meter.
  router.get('/', async (req, res, next) => {
    try {
      // Not configured, or switched off for this user's role: the UI hides the assistant.
      if (!config.assistant || !mayUseAssistant(req)) return res.json({ enabled: false });
      return res.json({ enabled: true, usage: await getAllowance(config, req.user) });
    } catch (err) {
      return next(err);
    }
  });

  // Per-account burst limits, counted in Mongo so every instance shares them.
  // Daily and monthly spend caps are separate (assistant.guard.js).
  const chatLimiter = makeLimiter({
    windowMs: MINUTE, limit: 20, byUser: true, store: new MongoRateLimitStore('assistant-chat'),
  });
  const voiceLimiter = makeLimiter({
    windowMs: MINUTE, limit: 30, byUser: true, store: new MongoRateLimitStore('assistant-voice'),
  });

  router.post('/chat', requireAssistant(config), chatLimiter, validate(chatSchema), async (req, res, next) => {
    /**
     * Streaming: { type: 'delta', text } and { type: 'reset' } while the model
     * writes, then { type: 'done', reply, actions, sig } or { type: 'error', error }.
     * Headers go out with the first event, so a refusal before any text (budget,
     * busy, bad input) is still an ordinary error response.
     */
    const send = (event) => {
      if (!res.headersSent) {
        res.status(200).set({
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache',
          // Proxies (nginx) would otherwise hold the stream back until it ends.
          'X-Accel-Buffering': 'no',
        });
      }
      res.write(`${JSON.stringify(event)}\n`);
      res.flush?.(); // compression, if it ever wraps this type
    };
    try {
      const { mode, stream } = req.body;
      if (req.body.messages[req.body.messages.length - 1].role !== 'user') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The last message must be from the user.');
      }
      // The browser holds the chat and builds the address: neither is trusted as sent.
      const messages = signedHistory(config, req.user, req.body.messages);
      const page = safePage(req.body.page);
      // If the user interrupts or leaves, stop paying for an answer nobody will read,
      // which also frees their chat lock for the next message.
      const cancelled = new AbortController();
      res.on('close', () => { if (!res.writableEnded) cancelled.abort(); });
      // One turn at a time per user, refused once today's allowance is spent.
      const { reply, actions } = await withChatLock(req.user, async () => {
        await checkAllowance(config, req.user);
        const started = Date.now();
        const turn = await chat(config, req.user, req.permissionContext, messages, {
          mode, page, signal: cancelled.signal, ...(stream ? { onStream: send } : {}),
        });
        logger.info('assistant: chat timing', { mode, ms: Date.now() - started });
        await recordUsage(config, req.user, turn.usage);
        await rememberReply(req.user, turn.reply, new Date(), namesIn(turn.actions));
        return turn;
      });
      const result = { reply, actions, ...(reply ? { sig: signReply(config, req.user, reply) } : {}) };
      if (!stream) return res.json(result);
      send({ type: 'done', ...result });
      return res.end();
    } catch (err) {
      if (!res.headersSent) return next(err);
      // Mid-stream: the status is already 200, so the error goes as the last event.
      if (!err?.isOperational) logger.error('assistant: chat stream failed', { error: err?.message, stack: err?.stack });
      if (!res.writableEnded && !res.destroyed) {
        send({
          type: 'error',
          error: err?.isOperational
            ? { code: err.code, message: err.message }
            : { code: 'ASSISTANT_FAILED', message: 'The assistant could not answer. Try again.' },
        });
        res.end();
      }
      return undefined;
    }
  });

  // "Continue in a new chat": a signed summary of this one to start the next with.
  router.post('/summarize', requireAssistant(config), chatLimiter, validate(summarySchema), async (req, res, next) => {
    try {
      const messages = signedHistory(config, req.user, req.body.messages);
      const cancelled = new AbortController();
      res.on('close', () => { if (!res.writableEnded) cancelled.abort(); });
      const { summary } = await withChatLock(req.user, async () => {
        await checkAllowance(config, req.user);
        const result = await summarize(config, messages, { signal: cancelled.signal });
        await recordUsage(config, req.user, result.usage);
        return result;
      });
      res.json({ summary, sig: signReply(config, req.user, summary) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/transcribe', requireAssistant(config), voiceLimiter, (req, res, next) => {
    audioUpload(req, res, async (uploadErr) => {
      try {
        if (uploadErr?.code === 'LIMIT_FILE_SIZE') {
          throw new ApiError(413, 'AUDIO_TOO_LARGE', 'That recording is too long. Keep it under a minute.');
        }
        if (uploadErr) throw new ApiError(400, 'VALIDATION_ERROR', 'Send one audio file in the "audio" field.');
        if (!req.file || !isAudio(req.file.buffer)) {
          throw new ApiError(400, 'UNSUPPORTED_AUDIO', 'That doesn\'t look like an audio recording.');
        }
        await checkAllowance(config, req.user);
        // Charged up front, so recordings sent in parallel each see the others' cost,
        // then settled to what OpenAI billed: the 60-second cap is the browser's, and
        // a caller can send an hour of low-bitrate audio in 5MB.
        const estimate = estimateAudioSeconds(req.file.size);
        await recordUsage(config, req.user, { transcribeSeconds: estimate });
        // The user's project keys and names help the transcriber spell them right.
        const started = Date.now();
        let result;
        try {
          const vocabulary = await projectRoster({ user: req.user, permissionContext: req.permissionContext, projects: null });
          result = await transcribe(config, req.file, { vocabulary });
        } catch (err) {
          await recordUsage(config, req.user, { transcribeSeconds: -estimate });
          throw err;
        }
        const { text, attempts, seconds } = result;
        logger.info('assistant: transcribe timing', { bytes: req.file.size, attempts, ms: Date.now() - started });
        const billed = seconds ?? estimateAudioSeconds(req.file.size, Infinity) * attempts;
        await recordUsage(config, req.user, { transcribeSeconds: billed - estimate });
        res.json({ text });
      } catch (err) {
        next(err);
      }
    });
  });

  router.post('/speech', requireAssistant(config), voiceLimiter, validate(speechSchema), async (req, res, next) => {
    try {
      // Read-aloud is for the assistant's replies, not a free text-to-speech service.
      const allowed = speechAllowed(req.body.text, {
        isRecentReply: await isRecentReply(req.user, req.body.text),
        names: await recentNames(req.user),
      });
      if (!allowed) {
        throw new ApiError(400, 'SPEECH_NOT_ALLOWED', 'Only the assistant\'s replies can be read aloud.');
      }
      await checkAllowance(config, req.user);
      // Interrupted or left: stop synthesising audio nobody will hear.
      const cancelled = new AbortController();
      res.on('close', () => { if (!res.writableEnded) cancelled.abort(); });
      const started = Date.now();
      const upstream = await speak(config, req.body.text, { language: req.body.language, signal: cancelled.signal });
      const firstAudioMs = Date.now() - started;
      // Billed once synthesis starts, whether or not all of it gets played.
      await recordUsage(config, req.user, { speechChars: req.body.text.length });
      // Passed through as it is synthesised, so the browser starts playing early.
      res.set('Content-Type', 'audio/mpeg');
      await pipeline(Readable.fromWeb(upstream.body), res);
      logger.info('assistant: speech timing', {
        chars: req.body.text.length, firstAudioMs, ms: Date.now() - started,
      });
    } catch (err) {
      // Mid-stream (usually the user interrupting): the response is already under
      // way, and pipeline has closed it; there is no error to send.
      if (res.headersSent) return;
      next(err);
    }
  });

  return router;
}
