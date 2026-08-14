import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderInviteEmail,
  renderPasswordResetEmail,
  renderTicketEmail,
  listEmailPreviews,
  escapeHtml,
} from '../email/index.js';

const SAMPLE_TICKET = {
  ticketId: 'WEB-142',
  title: 'Fix login redirect on mobile',
  description: 'Users on iOS Safari are redirected to /login after OAuth callback.',
  status: 'ready_qa',
  module: 'Authentication',
  page: 'Login flow',
  category: 'Bug',
  priority: 'High',
  severity: 'Major',
  environment: 'Staging',
  labels: ['mobile', 'oauth'],
  assignedTo: { name: 'Kai Patel' },
  createdBy: { name: 'Ada Lovelace' },
  estimatedResolutionAt: '2026-08-20T00:00:00.000Z',
  expectedReleaseDate: '2026-08-22T00:00:00.000Z',
  reopenCount: 1,
};

const SUPPORT_PATTERNS = [/support@dharwin/i, /Contact support/i, /Need help/i, /mailto:/i];

function assertNoSupportCopy(html) {
  for (const pattern of SUPPORT_PATTERNS) {
    assert.doesNotMatch(html, pattern, `Unexpected support copy matching ${pattern}`);
  }
}

function assertCtaHasReadableText(html) {
  assert.match(html, /color:#ffffff !important/i, 'CTA anchor should force white text for Gmail');
  assert.match(html, /-webkit-text-fill-color:#ffffff/i, 'CTA anchor should set webkit text fill');
  assert.match(html, /bgcolor="#4a5fa8"/i, 'CTA cell should include bgcolor fallback');
}

/**
 * A font stack quoted with " inside a style="..." attribute closes the
 * attribute early and silently drops every declaration after font-family:
 * the CTA loses its colour, radius and background. Substring assertions still
 * pass in that state, so assert the SHAPE of the attribute instead.
 */
function assertCtaStyleSurvivesFontFamily(html) {
  const anchor = html.match(/<a [^>]*style="([^"]*)"/);
  if (!anchor) return;
  assert.match(
    anchor[1],
    /text-decoration:none/,
    'CTA style attribute lost every declaration after font-family',
  );
}

test('a quoted font name never truncates a style attribute', () => {
  for (const item of listEmailPreviews()) {
    assertCtaStyleSurvivesFontFamily(item.html);
  }
});

test('escapeHtml escapes user content', () => {
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
});

test('invite email includes html, text, eyebrow, and cta link', () => {
  const msg = renderInviteEmail({
    link: 'http://localhost:3002/invite/accept?token=abc',
    recipientEmail: 'ada@example.com',
  });
  assert.match(msg.subject, /invited to Dharwin PMS/i);
  assert.match(msg.text, /invite\/accept\?token=abc/);
  assert.match(msg.html, /Accept invite/);
  assert.match(msg.html, /invite\/accept\?token=abc/);
  assert.match(msg.html, /Invitation/i);
  assert.match(msg.html, /Dharwin PMS/);
  assertCtaHasReadableText(msg.html);
  assert.doesNotMatch(msg.html, /This link expires in 72 hours\./i);
  assertNoSupportCopy(msg.html);
});

test('password reset email includes reset link and security eyebrow', () => {
  const msg = renderPasswordResetEmail({ link: 'http://localhost:3002/reset-password?token=xyz' });
  assert.match(msg.subject, /Reset your Dharwin PMS password/i);
  assert.match(msg.text, /reset-password\?token=xyz/);
  assert.match(msg.html, /Reset password/);
  assert.match(msg.html, /Account security/i);
  assertCtaHasReadableText(msg.html);
  assert.doesNotMatch(msg.html, /This link expires in 2 hours\./i);
  assertNoSupportCopy(msg.html);
});

test('ticket email keeps bracketed subject pattern and enriched layout', () => {
  const msg = renderTicketEmail(
    'TICKET_STAGE_CHANGED',
    SAMPLE_TICKET,
    {
      actorName: 'Kai Patel',
      from: 'ready_local',
      to: 'ready_qa',
      note: 'Ready for QA review.',
    },
    { frontendBaseUrl: 'http://localhost:3002' },
  );
  assert.match(msg.subject, /\[WEB-142\]/);
  assert.match(msg.text, /WEB-142: Fix login redirect on mobile/);
  assert.match(msg.html, /Open ticket/);
  assertCtaHasReadableText(msg.html);
  assert.match(msg.html, /Stage moved/i);
  assert.match(msg.html, /Stage 5 of 10/);
  assert.match(msg.html, /Ready for QA/);
  assert.match(msg.html, /Kai Patel/);
  assert.match(msg.html, /Ready for QA review/);
  assert.match(msg.html, /Replies to this address are not monitored/);
  assertNoSupportCopy(msg.html);
});

test('ticket comment email includes quote block and author', () => {
  const msg = renderTicketEmail(
    'TICKET_COMMENTED',
    SAMPLE_TICKET,
    {
      actorName: 'Jordan Lee',
      to: 'ready_qa',
      comment: 'QA passed on staging.',
      commentAuthor: 'Jordan Lee',
    },
    { frontendBaseUrl: 'http://localhost:3002' },
  );
  assert.match(msg.html, /Comment from Jordan Lee/);
  assert.match(msg.html, /QA passed on staging/);
  assertNoSupportCopy(msg.html);
});

test('ticket email escapes XSS payloads in title, comment, and actor name', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const msg = renderTicketEmail(
    'TICKET_COMMENTED',
    { ...SAMPLE_TICKET, title: payload },
    {
      actorName: payload,
      to: 'ready_qa',
      comment: payload,
      commentAuthor: payload,
    },
    { frontendBaseUrl: 'http://localhost:3002' },
  );

  assert.doesNotMatch(msg.html, /<img src=x onerror/i);
  assert.match(msg.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(msg.html, /<script/i);
});

test('invite email escapes recipient name XSS payloads', () => {
  const payload = '<script>alert(1)</script>';
  const msg = renderInviteEmail({
    link: 'http://localhost:3002/invite/accept?token=abc',
    recipientName: payload,
  });
  assert.doesNotMatch(msg.html, /<script/i);
  assert.match(msg.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('listEmailPreviews returns all email types without support copy', () => {
  const previews = listEmailPreviews();
  assert.equal(previews.length, 10);
  assert.ok(previews.some((item) => item.id === 'invite'));
  assert.ok(previews.some((item) => item.id === 'password-reset'));
  assert.ok(previews.some((item) => item.id === 'ticket-stage-changed'));

  for (const item of previews) {
    assert.ok(item.subject, `${item.id} should have a subject`);
    assert.ok(item.html, `${item.id} should have html`);
    if (item.html.includes('Accept invite') || item.html.includes('Reset password') || item.html.includes('Open ticket')) {
      assertCtaHasReadableText(item.html);
    }
    assertNoSupportCopy(item.html);
  }

  const stageChanged = previews.find((item) => item.id === 'ticket-stage-changed');
  assert.match(stageChanged.html, /WEB-142/);
  assert.match(stageChanged.html, /Anselm Okonkwo/);
  assert.match(stageChanged.html, /Stage 5 of 10/);
});