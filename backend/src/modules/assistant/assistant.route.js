import express from 'express';
import Joi from 'joi';
import multer from 'multer';
import { auth } from '../../platform/auth.js';
import { ApiError } from '../../platform/errors.js';
import { makeLimiter } from '../../platform/rateLimit.js';
import { validate } from '../../platform/validate.js';
import { chat } from './assistant.service.js';
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

function requireAssistant(config) {
  return (_req, _res, next) => (config.assistant
    ? next()
    : next(new ApiError(503, 'ASSISTANT_DISABLED', 'The assistant is not configured.')));
}

export default function assistantRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  // Tells the UI whether to show the chat button at all.
  router.get('/', (_req, res) => res.json({ enabled: Boolean(config.assistant) }));

  // Per-account limits: every call here costs money upstream.
  const chatLimiter = makeLimiter({ windowMs: MINUTE, limit: 20, byUser: true });
  const voiceLimiter = makeLimiter({ windowMs: MINUTE, limit: 30, byUser: true });

  router.post('/chat', requireAssistant(config), chatLimiter, validate(chatSchema), async (req, res, next) => {
    try {
      const { messages } = req.body;
      if (messages[messages.length - 1].role !== 'user') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The last message must be from the user.');
      }
      res.json(await chat(config, req.user, req.permissionContext, messages));
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
        res.json({ text: await transcribe(config, req.file) });
      } catch (err) {
        next(err);
      }
    });
  });

  router.post('/speech', requireAssistant(config), voiceLimiter, validate(speechSchema), async (req, res, next) => {
    try {
      const audio = await speak(config, req.body.text);
      res.set('Content-Type', 'audio/mpeg').send(audio);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
