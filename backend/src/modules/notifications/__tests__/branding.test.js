import test from 'node:test';
import assert from 'node:assert/strict';
import { brandedFrom, clientBranding, ticketBranding } from '../branding.js';
import { renderInviteEmail, renderPasswordResetEmail } from '../../../platform/email/templates/index.js';

const withS3 = { features: { attachments: true }, email: { from: 'no-reply@vendor.com' } };
const noS3 = { features: { attachments: false }, email: { from: 'no-reply@vendor.com' } };

test('ticket branding names the client and carries its logo', () => {
  const ticket = { project: { client: { name: 'Acme', logoKey: 'clients/acme.png' } } };
  assert.deepEqual(ticketBranding(ticket, withS3), {
    brandName: 'Acme PMS',
    brandLogoKey: 'clients/acme.png',
  });
});

test('a client already called PMS is not called PMS twice', () => {
  assert.equal(ticketBranding({ project: { brand: 'Beta PMS' } }, withS3).brandName, 'Beta PMS');
});

test('an unnamed project yields no branding, so the send fails closed', () => {
  assert.equal(ticketBranding({ project: {} }, withS3), null);
  assert.equal(ticketBranding({}, withS3), null);
});

test('no object storage means no logo key, never a stale one', () => {
  assert.equal(clientBranding({ name: 'Acme', logoKey: 'k' }, noS3).brandLogoKey, undefined);
});

test('From carries the client display name over the fixed vendor address', () => {
  assert.equal(brandedFrom(withS3, 'Acme PMS'), '"Acme PMS" <no-reply@vendor.com>');
  assert.equal(
    brandedFrom({ email: { from: '"Help" <a@vendor.com>' } }, 'Acme PMS'),
    '"Acme PMS" <a@vendor.com>',
  );
});

test('From falls back to the configured address when there is no brand', () => {
  assert.equal(brandedFrom(withS3, ''), 'no-reply@vendor.com');
});

test('a quote in a client name cannot break out of the From header', () => {
  assert.equal(brandedFrom(withS3, 'Ac"me'), '"Acme" <no-reply@vendor.com>');
});

test('a branded invite never mentions the vendor', () => {
  const msg = renderInviteEmail({
    link: 'https://pms.test/invite/accept?token=t',
    recipientEmail: 'ann@acme.test',
    brandName: 'Acme PMS',
  });
  assert.match(msg.subject, /Acme PMS/);
  assert.doesNotMatch(msg.subject + msg.text + msg.html, /ProwPlus/i);
});

test('a branded password reset never mentions the vendor', () => {
  const msg = renderPasswordResetEmail({
    link: 'https://pms.test/reset-password?token=t',
    recipientName: 'Ann',
    brandName: 'Acme PMS',
  });
  assert.equal(msg.subject, 'Reset your Acme PMS password');
  assert.doesNotMatch(msg.subject + msg.text + msg.html, /ProwPlus/i);
});

test('an unbranded invite still sends — a first invite has no client yet', () => {
  const msg = renderInviteEmail({ link: 'https://pms.test/i', recipientEmail: 'dev@vendor.com' });
  assert.match(msg.subject, /ProwPlus/);
});

test('CRLF in a client name cannot inject a header', () => {
  const evil = 'Acme\r\nBcc: attacker@evil.test';
  const { brandName } = ticketBranding({ project: { client: { name: evil } } }, withS3);
  assert.equal(brandName, 'Acme Bcc: attacker@evil.test PMS');
  assert.doesNotMatch(brandName, /[\r\n]/);
  const from = brandedFrom(withS3, brandName);
  assert.doesNotMatch(from, /[\r\n]/);
  assert.equal(from, '"Acme Bcc: attacker@evil.test PMS" <no-reply@vendor.com>');
});

test('a name that is only control characters yields no branding', () => {
  assert.equal(ticketBranding({ project: { client: { name: '\r\n\t' } } }, withS3), null);
});
