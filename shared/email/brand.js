/** Email-safe brand tokens aligned with design-system.css light palette. */
export const EMAIL_BRAND = Object.freeze({
  name: 'ProwPlus',
  tagline: '',
  fullName: 'ProwPlus',
  shortName: 'ProwPlus',
  /**
   * The mark travels with the message as an attachment under this content id.
   * Gmail and Outlook block remote images and data: URIs by default; a cid
   * attachment is the only form that renders on first open, every time.
   */
  // Vendor-neutral on purpose: the mark is a client's logo more often than
  // ours, and the id is readable in the raw MIME the recipient keeps forever.
  // ponytail: changing this orphans the cid baked into already-queued
  // renderSnapshot rows — they retry with a broken image until the outbox
  // drains. Snapshot the cid alongside the html if that ever costs more than a
  // retry window.
  logoCid: 'brand-mark',
  colors: Object.freeze({
    canvas: '#eae8e3',
    paper: '#f8f7f4',
    panel: '#f2f1ed',
    ink: '#2c3140',
    inkSecondary: '#5c6370',
    inkMuted: '#7a8190',
    sig: '#4a5fa8',
    sigHover: '#3f528f',
    sigInk: '#ffffff',
    sigWash: '#eceef7',
    rule: '#dfddd6',
    ruleSoft: '#e8e6e0',
    // Pipeline rail: stages cleared, the stage the ticket sits in, stages ahead.
    railDone: '#b9c1de',
    railNow: '#4a5fa8',
    railTodo: '#e0ded7',
    alarm: '#a4362b',
    alarmWash: '#f7ecea',
  }),
  // Family names are quoted with ' on purpose. These stacks are written into
  // style="..." attributes, and a " here closes the attribute early, silently
  // dropping every declaration that follows font-family.
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI Variable Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  monoFamily:
    "ui-monospace, 'Cascadia Mono', 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, monospace",
});
