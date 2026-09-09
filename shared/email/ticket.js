import { STAGES, stageIndex, stageLabel } from '../stages.js';
import { EMAIL_BRAND } from './brand.js';
import {
  renderEmailLayout, eyebrow, paragraph, detailTable, quoteBlock,
} from './layout.js';

const C = EMAIL_BRAND.colors;
const F = EMAIL_BRAND.fontFamily;

const EVENT_COPY = Object.freeze({
  TICKET_CREATED: {
    kicker: 'Ticket filed',
    lead: (actor) => `${actor} filed this ticket.`,
    cta: 'Open ticket',
  },
  TICKET_ASSIGNED: {
    kicker: 'Assigned to you',
    lead: (actor) => `${actor} assigned this ticket to you.`,
    cta: 'Start work',
  },
  TICKET_STAGE_CHANGED: {
    kicker: 'Stage moved',
    lead: (actor) => `${actor} moved this ticket to a new stage.`,
    cta: 'Open ticket',
  },
  TICKET_REOPENED: {
    kicker: 'Reopened',
    lead: (actor) => `${actor} reopened this ticket and sent it back to development.`,
    cta: 'Pick it back up',
  },
  TICKET_CLOSED: {
    kicker: 'Closed',
    lead: (actor) => `${actor} closed this ticket.`,
    cta: 'View the record',
  },
  TICKET_COMMENTED: {
    kicker: 'New comment',
    lead: (actor) => `${actor} commented on this ticket.`,
    cta: 'Reply on the ticket',
  },
  TICKET_MENTIONED: {
    kicker: 'You were mentioned',
    lead: (actor) => `${actor} mentioned you in a comment.`,
    cta: 'Reply on the ticket',
  },
  TICKET_ESTIMATE_SET: {
    kicker: 'Estimates updated',
    lead: (actor) => `${actor} updated the delivery estimates on this ticket.`,
    cta: 'Open ticket',
  },
});

const FALLBACK_COPY = Object.freeze({
  kicker: 'Ticket updated',
  lead: (actor) => `${actor} updated this ticket.`,
  cta: 'Open ticket',
});

/** Refs arrive unpopulated on some paths; only a real document carries a name. */
function nameOf(ref) {
  if (ref && typeof ref === 'object' && typeof ref.name === 'string') return ref.name;
  return '';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function truncate(text, max) {
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * THE signature block: ten segments, one per pipeline stage, filled to where
 * the ticket actually sits. Built from STAGES so it cannot drift from the board,
 * and drawn in table cells with border spacers so Outlook renders it too.
 */
function pipelineRail(statusKey) {
  const current = stageIndex(statusKey);
  if (current < 0) return '';

  const segments = STAGES.map((_stage, i) => {
    let background = C.railTodo;
    if (i < current) background = C.railDone;
    if (i === current) background = C.railNow;
    const last = i === STAGES.length - 1;
    return '<td style="height:6px;line-height:6px;font-size:0;background:' + background + ';'
      + 'border-radius:2px;' + (last ? '' : 'border-right:3px solid ' + C.paper + ';') + '">&nbsp;</td>';
  }).join('');

  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 0;">'
    + '<tr>'
    + '<td style="font-family:' + F + ';font-size:11px;line-height:1.2;letter-spacing:0.07em;'
    + 'text-transform:uppercase;font-weight:600;color:' + C.inkMuted + ';padding:0 0 8px;">'
    + 'Stage ' + (current + 1) + ' of ' + STAGES.length + '</td>'
    + '<td align="right" style="font-family:' + F + ';font-size:12px;line-height:1.2;font-weight:600;'
    + 'color:' + C.sig + ';padding:0 0 8px;">' + stageLabel(statusKey) + '</td>'
    + '</tr>'
    + '<tr><td colspan="2">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">'
    + '<tr>' + segments + '</tr>'
    + '</table>'
    + '</td></tr>'
    + '</table>';
}

/** from -> to, so the change is legible before the details table. */
function transitionStrip(from, to) {
  if (!to) return '';
  const cell = (text, strong) => '<td style="font-family:' + F + ';font-size:14px;line-height:1.3;'
    + 'font-weight:' + (strong ? '700' : '500') + ';color:' + (strong ? C.ink : C.inkMuted) + ';">'
    + text + '</td>';
  return '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0;">'
    + '<tr>'
    + (from ? cell(stageLabel(from), false) : '')
    + (from ? '<td style="padding:0 10px;color:' + C.inkMuted + ';font-size:14px;">&rarr;</td>' : '')
    + cell(stageLabel(to), true)
    + '</tr></table>';
}

export function ticketEmailSubject(event, ticket, context = {}) {
  const subjects = {
    TICKET_CREATED: (t) => `[${t.ticketId}] Filed: ${t.title}`,
    TICKET_ASSIGNED: (t) => `[${t.ticketId}] Assigned: ${t.title}`,
    TICKET_STAGE_CHANGED: (t, c) => `[${t.ticketId}] ${stageLabel(c.to)}: ${t.title}`,
    TICKET_REOPENED: (t) => `[${t.ticketId}] Reopened: ${t.title}`,
    TICKET_CLOSED: (t) => `[${t.ticketId}] Closed: ${t.title}`,
    TICKET_COMMENTED: (t) => `[${t.ticketId}] New comment: ${t.title}`,
    TICKET_MENTIONED: (t) => `[${t.ticketId}] You were mentioned: ${t.title}`,
    TICKET_ESTIMATE_SET: (t) => `[${t.ticketId}] Estimates updated: ${t.title}`,
  };
  const fn = subjects[event] ?? ((t) => `[${t.ticketId}] ${t.title}`);
  return fn(ticket, context);
}

/**
 * Every ticket field the recipient needs to triage without opening the app:
 * where it sits, who owns it, how urgent it is, when it is due. Rows resolve
 * to '' when the ticket does not carry them and detailTable drops them.
 */
function ticketFacts(ticket, context) {
  const place = [ticket.module, ticket.page].filter(Boolean).join(' / ');
  const labels = Array.isArray(ticket.labels) && ticket.labels.length
    ? ticket.labels.join(', ')
    : '';
  const urgent = ticket.priority === 'Urgent' || ticket.severity === 'Blocker';

  return [
    ['Ticket', ticket.ticketId, { mono: true, strong: true }],
    ['Stage', stageLabel(context.to ?? ticket.status), { strong: true }],
    ['Priority', [ticket.priority, ticket.severity].filter(Boolean).join(' / '),
      { strong: true, tone: urgent ? 'alarm' : undefined }],
    ['Type', ticket.category],
    ['Area', place],
    ['Environment', ticket.environment],
    ['Assignee', nameOf(ticket.assignedTo) || (ticket.assignedTo ? '' : 'Unassigned')],
    ['Reporter', nameOf(ticket.createdBy)],
    ['Labels', labels],
    ['Target date', formatDate(ticket.estimatedResolutionAt)],
    ['Release', formatDate(ticket.expectedReleaseDate)],
    ['Reopened', ticket.reopenCount > 0 ? `${ticket.reopenCount} time${ticket.reopenCount > 1 ? 's' : ''}` : ''],
    ['Blocked', ticket.blocked ? (ticket.blockerReason || 'Yes') : '', { tone: 'alarm' }],
  ];
}

function plainFacts(rows) {
  return rows
    .filter((row) => row && row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '')
    .map(([label, value]) => `${label}: ${value}`);
}

function ticketBrandName(context = {}) {
  if (typeof context.brandName !== 'string') return EMAIL_BRAND.shortName;
  const name = context.brandName.trim();
  return name || EMAIL_BRAND.shortName;
}

export function renderTicketEmail(event, ticket, context = {}, config = {}) {
  const link = `${config.frontendBaseUrl}/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`;
  const copy = EVENT_COPY[event] ?? FALLBACK_COPY;
  const actor = context.actorName || 'Someone';
  const lead = copy.lead(actor);

  const facts = ticketFacts(ticket, context);
  const comment = context.comment ? truncate(context.comment, 400) : '';
  const description = event === 'TICKET_CREATED' && ticket.description
    ? truncate(ticket.description, 400)
    : '';
  const commentLabel = context.commentAuthor
    ? `Comment from ${context.commentAuthor}`
    : 'Comment';

  const bodyHtml = [
    paragraph(lead),
    pipelineRail(context.to ?? ticket.status),
    // `to` defaults to the current stage on every event, so the strip is gated
    // on `from`: only a real transition has one, and only that is worth drawing.
    context.from ? transitionStrip(context.from, context.to ?? ticket.status) : '',
    quoteBlock('Note', context.note),
    quoteBlock('Reason', context.reason),
    quoteBlock(commentLabel, comment),
    quoteBlock('What was reported', description),
    detailTable(facts),
  ].filter(Boolean).join('');

  const text = [
    lead,
    '',
    `${ticket.ticketId}: ${ticket.title}`,
    '',
    ...plainFacts(facts),
    ...(context.from
      ? ['', `Moved: ${stageLabel(context.from)} -> ${stageLabel(context.to ?? ticket.status)}`]
      : []),
    ...(context.note ? ['', `Note: ${context.note}`] : []),
    ...(context.reason ? ['', `Reason: ${context.reason}`] : []),
    ...(comment ? ['', `${commentLabel}: ${comment}`] : []),
    ...(description ? ['', `What was reported: ${description}`] : []),
    '',
    link,
    '',
    'Attachment links in this email are presigned and expire shortly after sending.',
  ].join('\n');

  const html = renderEmailLayout({
    preheader: `${lead} ${ticket.ticketId}: ${ticket.title}`,
    eyebrow: eyebrow(copy.kicker, ticket.ticketId),
    title: ticket.title,
    bodyHtml,
    cta: { label: copy.cta, href: link },
    brandName: ticketBrandName(context),
    footerNote: 'Attachment links in this email are presigned and expire shortly after sending.',
  });

  return {
    subject: ticketEmailSubject(event, ticket, context),
    text,
    html,
  };
}
