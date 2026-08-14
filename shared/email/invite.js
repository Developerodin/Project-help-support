import { EMAIL_BRAND } from './brand.js';
import {
  renderEmailLayout, eyebrow, paragraph, detailTable,
} from './layout.js';

export function renderInviteEmail({ link, recipientName = '', recipientEmail = '' }) {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,';
  const subject = "You've been invited to Dharwin PMS";
  const headline = 'Accept your invite to join the workspace';

  const facts = [
    ['Workspace', EMAIL_BRAND.fullName],
    ['Sign in as', recipientEmail, { mono: true }],
    ['Link expires', '72 hours after this email was sent'],
  ];

  const text = [
    greeting,
    '',
    `You have been invited to ${EMAIL_BRAND.fullName}. Set your name and password to open your workspace.`,
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
    preheader: 'Set your name and password to join Dharwin PMS.',
    eyebrow: eyebrow('Invitation'),
    title: headline,
    bodyHtml,
    cta: { label: 'Accept invite', href: link },
    footerNote: 'If you did not expect this invite, ignore this email.',
  });

  return { subject, text, html };
}
