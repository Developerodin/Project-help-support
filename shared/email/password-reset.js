import { EMAIL_BRAND } from './brand.js';
import {
  renderEmailLayout, eyebrow, paragraph, detailTable,
} from './layout.js';

export function renderPasswordResetEmail({ link, recipientName = '', recipientEmail = '' }) {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';
  const subject = `Reset your ${EMAIL_BRAND.shortName} password`;
  const headline = 'Choose a new password';

  const facts = [
    ['Account', recipientEmail, { mono: true }],
    ['Workspace', EMAIL_BRAND.fullName],
    ['Link expires', '2 hours after this email was sent'],
  ];

  const text = [
    greeting,
    '',
    `We received a request to reset your ${EMAIL_BRAND.fullName} password.`,
    '',
    ...facts.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    '',
    `Reset your password: ${link}`,
    '',
    'If you did not request this, ignore this email. Your current password keeps working.',
  ].join('\n');

  const bodyHtml = [
    paragraph(greeting),
    paragraph(`We received a request to reset your password for ${EMAIL_BRAND.fullName}. The link below works once.`),
    detailTable(facts),
  ].join('');

  const html = renderEmailLayout({
    preheader: `Reset your ${EMAIL_BRAND.shortName} password.`,
    eyebrow: eyebrow('Account security'),
    title: headline,
    bodyHtml,
    cta: { label: 'Reset password', href: link },
    footerNote: 'If you did not request this, ignore this email. Your current password keeps working.',
  });

  return { subject, text, html };
}
