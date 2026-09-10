import { EMAIL_BRAND } from './brand.js';
import {
  renderEmailLayout, eyebrow, paragraph, detailTable,
} from './layout.js';

export function renderInviteEmail({
  link,
  recipientName = '',
  recipientEmail = '',
  brandName = '',
}) {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';
  // A first invite has no company to brand with — the client scope is granted
  // through the invite, so nothing links this person to a Client yet. Resends
  // and reactivations do resolve one, and this carries it.
  const brand = typeof brandName === 'string' && brandName.trim()
    ? brandName.trim()
    : EMAIL_BRAND.shortName;
  const subject = `You've been invited to ${brand}`;
  const headline = 'Accept your invite to join the workspace';

  const facts = [
    ['Workspace', brand],
    ['Sign in as', recipientEmail, { mono: true }],
    ['Link expires', '72 hours after this email was sent'],
  ];

  const text = [
    greeting,
    '',
    `You have been invited to ${brand}. Set your name and password to open your workspace.`,
    '',
    ...facts.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    '',
    `Set your password: ${link}`,
    '',
    'If you did not expect this invite, ignore this email.',
  ].join('\n');

  const bodyHtml = [
    paragraph(greeting),
    paragraph('Set your name and password to open your workspace.'),
    detailTable(facts),
  ].join('');

  const html = renderEmailLayout({
    preheader: `Set your name and password to join ${brand}.`,
    eyebrow: eyebrow('Invitation'),
    title: headline,
    bodyHtml,
    cta: { label: 'Accept invite', href: link },
    brandName: brand,
    footerNote: 'If you did not expect this invite, ignore this email.',
  });

  return { subject, text, html };
}
