import '../src/platform/loadEnv.js';
import { loadConfig } from '../src/platform/config.js';
import { getTransport, resetTransport } from '../src/platform/mailer.js';
import { listEmailPreviews } from '@pms/shared/email';

const TO = 'prakhar@theodin.in';

const config = loadConfig();
if (!config.features.email) {
  console.error('Email capability disabled: SMTP env group incomplete.');
  process.exit(1);
}

const transport = getTransport(config);
if (!transport) {
  console.error('Failed to create SMTP transport.');
  process.exit(1);
}

const previews = listEmailPreviews();
const results = [];

for (const preview of previews) {
  const subject = `[PMS email test] ${preview.subject}`;
  try {
    const info = await transport.sendMail({
      from: config.email.from,
      to: TO,
      subject,
      text: preview.text,
      html: preview.html,
    });
    results.push({ id: preview.id, label: preview.label, ok: true, messageId: info.messageId ?? null });
    console.log(`OK  ${preview.id} (${preview.label})`);
  } catch (err) {
    results.push({ id: preview.id, label: preview.label, ok: false, error: String(err.message || err) });
    console.error(`FAIL ${preview.id}: ${err.message}`);
  }
}

resetTransport();

console.log('\n--- Summary ---');
console.log(JSON.stringify({ to: TO, total: previews.length, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 2));
