export { EMAIL_BRAND } from './brand.js';
export { escapeHtml } from './escape.js';
export {
  renderEmailLayout, eyebrow, paragraph, detailTable, quoteBlock, mutedNote, linkFallback,
} from './layout.js';
export { renderInviteEmail } from './invite.js';
export { renderPasswordResetEmail } from './password-reset.js';
export { renderTicketEmail, ticketEmailSubject } from './ticket.js';

import { renderInviteEmail } from './invite.js';
import { renderPasswordResetEmail } from './password-reset.js';
import { renderTicketEmail } from './ticket.js';

const SAMPLE_BASE = 'http://localhost:3002';

/** One realistic ticket, carrying every field a real one can carry. */
const SAMPLE_TICKET = Object.freeze({
  ticketId: 'WEB-142',
  title: 'Login redirect drops the return path on mobile Safari',
  description: 'Opening a shared ticket link while signed out lands on the board root after sign-in instead of on the ticket. Reproduced on iOS 18.4 Safari and iPadOS 18.4. Desktop Safari is unaffected.',
  status: 'ready_qa',
  priority: 'High',
  severity: 'Major',
  category: 'Bug',
  module: 'Authentication',
  page: 'Sign in',
  environment: 'Staging',
  labels: ['regression', 'ui'],
  assignedTo: { name: 'Anselm Okonkwo' },
  createdBy: { name: 'Priya Raghunathan' },
  estimatedResolutionAt: '2026-08-21T00:00:00.000Z',
  expectedReleaseDate: '2026-08-28T00:00:00.000Z',
  reopenCount: 0,
  blocked: false,
});

/**
 * Each preview overrides the ticket AND the context, so the gallery shows the
 * rail at different pipeline positions rather than eight copies of one state.
 */
const TICKET_SCENARIOS = Object.freeze([
  {
    event: 'TICKET_CREATED',
    ticket: { status: 'pending', assignedTo: null, labels: ['regression'] },
    context: { actorName: 'Priya Raghunathan' },
  },
  {
    event: 'TICKET_ASSIGNED',
    ticket: { status: 'under_review' },
    context: { actorName: 'Mira Vasquez' },
  },
  {
    event: 'TICKET_STAGE_CHANGED',
    ticket: { status: 'ready_qa' },
    context: {
      actorName: 'Anselm Okonkwo',
      from: 'ready_local',
      to: 'ready_qa',
      note: 'Return path now survives the auth round trip. Worth testing on a real iPhone, the simulator did not reproduce it.',
    },
  },
  {
    event: 'TICKET_REOPENED',
    ticket: { status: 'in_progress', reopenCount: 2 },
    context: {
      actorName: 'Mira Vasquez',
      reason: 'Still redirects to the board when the link carries a comment anchor.',
    },
  },
  {
    event: 'TICKET_CLOSED',
    ticket: { status: 'closed', reopenCount: 2 },
    context: {
      actorName: 'Priya Raghunathan',
      reason: 'Verified on production for iOS 18.4 and 18.5.',
    },
  },
  {
    event: 'TICKET_COMMENTED',
    ticket: { status: 'deployed_staging' },
    context: {
      actorName: 'Anselm Okonkwo',
      commentAuthor: 'Anselm Okonkwo',
      comment: 'Staging build 412 is up. The redirect keeps the query string now, but the comment anchor is still stripped. Filing that separately unless QA reads it as the same defect.',
    },
  },
  {
    event: 'TICKET_MENTIONED',
    ticket: { status: 'deployed_staging' },
    context: {
      actorName: 'Mira Vasquez',
      commentAuthor: 'Mira Vasquez',
      comment: 'Anselm, can you confirm build 412 covers the iPadOS case before I sign this off?',
    },
  },
  {
    event: 'TICKET_ESTIMATE_SET',
    ticket: {
      status: 'in_progress',
      estimatedResolutionAt: '2026-08-19T00:00:00.000Z',
      expectedReleaseDate: '2026-08-26T00:00:00.000Z',
    },
    context: { actorName: 'Priya Raghunathan' },
  },
]);

function titleCase(event) {
  return event
    .replace(/^TICKET_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function listEmailPreviews() {
  const linkInvite = `${SAMPLE_BASE}/invite/accept?token=sample-invite-token`;
  const linkReset = `${SAMPLE_BASE}/reset-password?token=sample-reset-token`;

  const transactional = [
    {
      id: 'invite',
      label: 'Invite',
      category: 'Transactional',
      ...renderInviteEmail({
        link: linkInvite,
        recipientName: 'Ada Lovelace',
        recipientEmail: 'ada.lovelace@dharwin.com',
      }),
    },
    {
      id: 'password-reset',
      label: 'Password reset',
      category: 'Transactional',
      ...renderPasswordResetEmail({
        link: linkReset,
        recipientName: 'Ada Lovelace',
        recipientEmail: 'ada.lovelace@dharwin.com',
      }),
    },
  ];

  const ticketEvents = TICKET_SCENARIOS.map(({ event, ticket, context }) => ({
    id: event.toLowerCase().replace(/_/g, '-'),
    label: titleCase(event),
    category: 'Ticket notifications',
    ...renderTicketEmail(
      event,
      { ...SAMPLE_TICKET, ...ticket },
      context,
      { frontendBaseUrl: SAMPLE_BASE },
    ),
  }));

  return [...transactional, ...ticketEvents];
}
