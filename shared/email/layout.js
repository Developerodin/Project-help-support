import { EMAIL_BRAND } from './brand.js';
import { escapeHtml } from './escape.js';

const C = EMAIL_BRAND.colors;
const F = EMAIL_BRAND.fontFamily;
const M = EMAIL_BRAND.monoFamily;

/**
 * The PROWPLUS mark, attached to the message rather than fetched, so it renders
 * on first open in clients that block remote content. alt is empty on purpose:
 * the brand name sits beside it as live text, so an images-off client still
 * reads "PROWPLUS PMS" once, not twice.
 */
function brandMark() {
  return (
    '<img src="cid:' + escapeHtml(EMAIL_BRAND.logoCid) + '" width="30" height="30" alt=""'
    + ' style="display:inline-block;vertical-align:middle;margin-right:10px;'
    + 'border:0;outline:none;text-decoration:none;">'
  );
}

/**
 * Bulletproof CTA: bgcolor on td, background + border on anchor, and
 * !important color so Gmail does not inherit dark link text on sig fill.
 */
function renderCta({ label, href }) {
  if (!label || !href) return '';
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return (
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;">'
    + '<tr>'
    + '<td align="center" bgcolor="' + C.sig + '" style="background-color:' + C.sig + ';border-radius:4px;mso-padding-alt:0;">'
    + '<!--[if mso]><i style="letter-spacing:25px;mso-font-width:-100%;mso-text-raise:30pt">&nbsp;</i><![endif]-->'
    + '<a href="' + safeHref + '" target="_blank" rel="noopener noreferrer" '
    + 'style="display:inline-block;padding:12px 22px;font-family:' + F + ';font-size:14px;font-weight:600;line-height:1;'
    + 'color:' + C.sigInk + ' !important;-webkit-text-fill-color:' + C.sigInk + ';text-decoration:none;border-radius:4px;'
    + 'background-color:' + C.sig + ';border:1px solid ' + C.sig + ';mso-border-alt:none;">'
    + safeLabel
    + '</a>'
    + '<!--[if mso]><i style="letter-spacing:25px;mso-font-width:-100%">&nbsp;</i><![endif]-->'
    + '</td>'
    + '</tr></table>'
  );
}

/**
 * Gmail otherwise pulls the first body sentence into the inbox snippet and
 * prints the preheader twice. The spacer run pushes that boundary past it.
 */
function preheaderBlock(text) {
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(60);
  return '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;">'
    + escapeHtml(text) + spacer + '</div>';
}

export function renderEmailLayout({
  preheader = '',
  eyebrow: eyebrowHtml = '',
  title,
  bodyHtml,
  cta = null,
  footerNote = '',
}) {
  const safeTitle = escapeHtml(title);

  return '<!DOCTYPE html>'
    + '<html lang="en">'
    + '<head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light">'
    + '<meta name="supported-color-schemes" content="light">'
    + '<title>' + safeTitle + '</title>'
    + '<style>'
    + '@media only screen and (max-width:620px){'
    + '.dh-card{padding:24px 18px !important;}'
    + '.dh-title{font-size:19px !important;}'
    + '.dh-label{width:96px !important;}'
    + '}'
    + '</style>'
    + '</head>'
    + '<body style="margin:0;padding:0;background:' + C.canvas + ';-webkit-font-smoothing:antialiased;">'
    + preheaderBlock(preheader)
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:' + C.canvas + ';">'
    + '<tr><td align="center" style="padding:32px 16px 40px;">'
    + '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">'

    + '<tr><td style="padding:0 0 14px;font-family:' + F + ';">'
    + brandMark()
    + '<span style="font-size:15px;font-weight:700;color:' + C.ink + ';letter-spacing:-0.01em;vertical-align:middle;">'
    + escapeHtml(EMAIL_BRAND.shortName) + '</span>'
    + '</td></tr>'

    + '<tr><td class="dh-card" style="background:' + C.paper + ';border:1px solid ' + C.rule + ';border-radius:6px;padding:30px 28px;">'
    + eyebrowHtml
    + '<h1 class="dh-title" style="margin:0 0 14px;font-family:' + F + ';font-size:21px;line-height:1.3;font-weight:700;color:' + C.ink + ';letter-spacing:-0.015em;">'
    + safeTitle + '</h1>'
    + '<div style="font-family:' + F + ';font-size:15px;line-height:1.6;color:' + C.inkSecondary + ';">'
    + bodyHtml
    + '</div>'
    + renderCta(cta)
    // The fallback explains the button, so it can only follow it. Owned here
    // rather than by each template, which appended it to bodyHtml and printed
    // it above the button it refers to.
    + (cta?.href ? linkFallback(cta.href) : '')
    + '</td></tr>'

    + '<tr><td style="padding:18px 4px 0;font-family:' + F + ';font-size:12px;line-height:1.6;color:' + C.inkMuted + ';">'
    + (footerNote ? '<p style="margin:0 0 8px;">' + escapeHtml(footerNote) + '</p>' : '')
    + '<p style="margin:0;">Automated message from ' + escapeHtml(EMAIL_BRAND.fullName)
    + '. Replies to this address are not monitored.</p>'
    + '</td></tr>'

    + '</table></td></tr></table>'
    + '</body></html>';
}

/** Small uppercase kicker above the headline: what happened, and to which ticket. */
export function eyebrow(label, badge = '') {
  const tag = badge
    ? '<span style="font-family:' + M + ';font-size:11px;font-weight:700;color:' + C.sig + ';letter-spacing:0.02em;">'
      + escapeHtml(badge) + '</span>'
      + '<span style="color:' + C.rule + ';padding:0 8px;">&#124;</span>'
    : '';
  return '<p style="margin:0 0 10px;font-family:' + F + ';font-size:11px;line-height:1.2;'
    + 'letter-spacing:0.09em;text-transform:uppercase;font-weight:600;color:' + C.inkMuted + ';">'
    + tag + escapeHtml(label) + '</p>';
}

export function paragraph(text) {
  return '<p style="margin:0 0 14px;">' + escapeHtml(text) + '</p>';
}

/**
 * Ticket facts as a key/value table with hairline rules, not sentences. Rows
 * with an empty value are dropped, so an email never shows a blank field.
 */
export function detailTable(rows) {
  const cells = rows
    .filter((row) => row && row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '')
    .map(([label, value, opts = {}]) => {
      const tone = opts.tone === 'alarm' ? C.alarm : C.ink;
      return '<tr>'
        + '<td class="dh-label" width="112" style="width:112px;padding:9px 14px 9px 0;border-top:1px solid ' + C.ruleSoft + ';'
        + 'font-family:' + F + ';font-size:11px;line-height:1.5;letter-spacing:0.06em;text-transform:uppercase;'
        + 'color:' + C.inkMuted + ';vertical-align:top;">' + escapeHtml(label) + '</td>'
        + '<td style="padding:9px 0;border-top:1px solid ' + C.ruleSoft + ';font-family:'
        + (opts.mono ? M : F) + ';font-size:14px;line-height:1.5;font-weight:' + (opts.strong ? '600' : '500') + ';'
        + 'color:' + tone + ';vertical-align:top;">' + escapeHtml(value) + '</td>'
        + '</tr>';
    })
    .join('');

  if (!cells) return '';
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0;">'
    + cells + '</table>';
}

/** Verbatim human text: a stage note, a close reason, a comment. */
export function quoteBlock(label, text) {
  if (!text) return '';
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0;">'
    + '<tr><td style="background:' + C.panel + ';border:1px solid ' + C.rule + ';border-radius:5px;padding:14px 16px;">'
    + (label
      ? '<p style="margin:0 0 7px;font-family:' + F + ';font-size:11px;line-height:1.2;letter-spacing:0.07em;'
        + 'text-transform:uppercase;font-weight:600;color:' + C.inkMuted + ';">' + escapeHtml(label) + '</p>'
      : '')
    + '<div style="font-family:' + F + ';font-size:14px;line-height:1.6;color:' + C.ink + ';">' + body + '</div>'
    + '</td></tr></table>';
}

export function mutedNote(text) {
  return '<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:' + C.inkMuted + ';">'
    + escapeHtml(text) + '</p>';
}

export function linkFallback(href) {
  return '<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:' + C.inkMuted + ';word-break:break-all;">'
    + 'Button not working? Paste this into your browser: <span style="font-family:' + M + ';">'
    + escapeHtml(href) + '</span></p>';
}
