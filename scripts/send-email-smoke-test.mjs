/**
 * Sends every template in the gallery to one address, through the same
 * renderer and the same inline brand attachment production uses. This is how
 * you learn what a real client does with the layout, which no preview can say.
 *
 *   node --env-file=.env scripts/send-email-smoke-test.mjs you@example.com
 *
 * Subjects carry a [SMOKE] prefix so a test run is never taken for real mail.
 */
import nodemailer from 'nodemailer';
import { listEmailPreviews } from '../shared/email/index.js';
import { brandAttachments } from '../backend/src/platform/email/logo.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node --env-file=.env scripts/send-email-smoke-test.mjs <address>');
  process.exit(1);
}

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'EMAIL_FROM'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(1);
}

const port = Number(process.env.SMTP_PORT);
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD },
  pool: true,
  maxConnections: 2,
  maxMessages: 100,
});

const attachments = brandAttachments();
console.log(`from ${process.env.EMAIL_FROM} -> ${to}`);
console.log(`brand mark: ${attachments ? `${attachments[0].content.length} bytes inline` : 'MISSING'}\n`);

const previews = listEmailPreviews();
let sent = 0;
let failed = 0;

for (const preview of previews) {
  try {
    await transport.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: `[SMOKE] ${preview.subject}`,
      text: preview.text,
      html: preview.html,
      attachments,
    });
    sent += 1;
    console.log(`  ok    ${preview.id.padEnd(22)} ${preview.subject}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${preview.id.padEnd(22)} ${err.message}`);
  }
}

transport.close();
console.log(`\n${sent} sent, ${failed} failed, ${previews.length} templates`);
process.exit(failed ? 1 : 0);
