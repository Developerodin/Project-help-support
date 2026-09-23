import express from 'express';
import Joi from 'joi';
import multer from 'multer';
import { can } from '@pms/shared';
import { auth } from '../../platform/auth.js';
import { ApiError } from '../../platform/errors.js';
import { MongoRateLimitStore, makeLimiter } from '../../platform/rateLimit.js';
import { validate } from '../../platform/validate.js';
import { chat } from './assistant.service.js';
import { TICKET_TABS, projectRoster } from './assistant.tools.js';
import {
  checkAllowance, estimateAudioSeconds, getAllowance, recordUsage, withChatLock,
} from './assistant.guard.js';
import { speak, transcribe } from './openai.client.js';

const MINUTE = 60 * 1000;
/** ~60s of browser-recorded opus is well under 1MB; 5MB leaves room for wav. */
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const chatSchema = {
  body: Joi.object({
    messages: Joi.array().min(1).max(30).items(Joi.object({
      role: Joi.string().valid('user', 'assistant').required(),
      content: Joi.string().trim().min(1).max(4000).required(),
    })).required(),
    // 'voice' when the user is talking in voice mode, so replies suit being heard.
    mode: Joi.string().valid('chat', 'voice').default('chat'),
    // Where the user is right now, so "this ticket" and "the details tab" mean something.
    page: Joi.object({
      path: Joi.string().max(200).pattern(/^\/[\w\-/]*$/).required(),
      ticketId: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/).allow(null),
      tab: Joi.string().valid(...TICKET_TABS).allow(null),
      // The project picked in the switcher (null = all projects).
      project: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9]{1,9}$/).allow(null),
    }),
  }),
};

const speechSchema = {
  body: Joi.object({ text: Joi.string().trim().min(1).max(2000).required() }),
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
    try {
      const { messages, mode, page } = req.body;
      if (messages[messages.length - 1].role !== 'user') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The last message must be from the user.');
      }
      // If the user interrupts or leaves, stop paying for an answer nobody will read,
      // which also frees their chat lock for the next message.
      const cancelled = new AbortController();
      res.on('close', () => { if (!res.writableEnded) cancelled.abort(); });
      // One turn at a time per user, refused once today's allowance is spent.
      const { reply, actions } = await withChatLock(req.user, async () => {
        await checkAllowance(config, req.user);
        const turn = await chat(config, req.user, req.permissionContext, messages, { mode, page, signal: cancelled.signal });
        await recordUsage(config, req.user, turn.usage);
        return turn;
      });
      res.json({ reply, actions });
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
        // The user's project keys and names help the transcriber spell them right.
        const vocabulary = await projectRoster({ user: req.user, permissionContext: req.permissionContext, projects: null });
        const { text, attempts } = await transcribe(config, req.file, { vocabulary });
        await recordUsage(config, req.user, { transcribeSeconds: estimateAudioSeconds(req.file.size) * attempts });
        res.json({ text });
      } catch (err) {
        next(err);
      }
    });
  });

  router.post('/speech', requireAssistant(config), voiceLimiter, validate(speechSchema), async (req, res, next) => {
    try {
      await checkAllowance(config, req.user);
      const audio = await speak(config, req.body.text);
      await recordUsage(config, req.user, { speechChars: req.body.text.length });
      res.set('Content-Type', 'audio/mpeg').send(audio);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
