import { EMAIL_BRAND } from './brand.js';
import {
  renderEmailLayout, eyebrow, paragraph, detailTable,
} from './layout.js';

export function renderPasswordResetEmail({
  link,
  recipientName = '',
  recipientEmail = '',
  brandName = '',
}) {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';
  // A client must never read the vendor's name on their own mail. When the
  // caller resolved their company, it replaces the neutral mark everywhere the
  // neutral mark would have appeared — subject line included.
  const brand = typeof brandName === 'string' && brandName.trim()
    ? brandName.trim()
    : EMAIL_BRAND.shortName;
  const subject = `Reset your ${brand} password`;
  const headline = 'Choose a new password';

  const facts = [
    ['Account', recipientEmail, { mono: true }],
    ['Workspace', brand],
    ['Link expires', '2 hours after this email was sent'],
  ];

  const text = [
    greeting,
    '',
    `We received a request to reset your ${brand} password.`,
    '',
    ...facts.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    '',
    `Reset your password: ${link}`,
    '',
    'If you did not request this, ignore this email. Your current password keeps working.',
  ].join('\n');

  const bodyHtml = [
    paragraph(greeting),
    paragraph(`We received a request to reset your password for ${brand}. The link below works once.`),
    detailTable(facts),
  ].join('');

  const html = renderEmailLayout({
    preheader: `Reset your ${brand} password.`,
    eyebrow: eyebrow('Account security'),
    title: headline,
    bodyHtml,
    cta: { label: 'Reset password', href: link },
    brandName: brand,
    footerNote: 'If you did not request this, ignore this email. Your current password keeps working.',
  });

  return { subject, text, html };
}
