/** Toast stack using `.toast-stack` / `.toast` from design-system.css */

const STACK_ID = 'app-toast-stack';
/** Enough to read, short enough to not linger. Hovering pauses it anyway. */
const DEFAULT_MS = 5000;
/** Older toasts are dropped rather than pushing the newest off screen. */
const MAX_VISIBLE = 3;
const EXIT_MS = 140;

function getStack() {
  let stack = document.getElementById(STACK_ID);
  if (stack) return stack;

  stack = document.createElement('div');
  stack.id = STACK_ID;
  stack.className = 'toast-stack';
  // The live region is the container, not each toast: announcing the region
  // once covers every toast added to it, where per-toast roles double up.
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-atomic', 'false');
  document.body.appendChild(stack);
  return stack;
}

function dismiss(el) {
  if (el._toastClosing) return;
  el._toastClosing = true;
  clearTimeout(el._toastTimer);
  el.classList.remove('on');
  setTimeout(() => el.remove(), EXIT_MS);
  el._toastOnClose?.();
}

function messageNode(message, tag, detail) {
  const text = document.createElement('div');
  text.className = 'toast-msg';
  const lead = document.createElement('span');
  lead.className = 'toast-lead';
  lead.textContent = message;
  text.appendChild(lead);
  if (tag || detail) {
    const sub = document.createElement('span');
    sub.className = 'toast-sub';
    if (tag) {
      const stamp = document.createElement('span');
      stamp.className = 'toast-tag';
      stamp.textContent = tag;
      sub.appendChild(stamp);
    }
    if (detail) {
      const rest = document.createElement('span');
      rest.className = 'toast-detail';
      rest.textContent = detail;
      // One line, cut with an ellipsis; the full text stays a hover away.
      rest.title = detail;
      sub.appendChild(rest);
    }
    text.appendChild(sub);
  }
  return text;
}

/**
 * @param message  text to show
 * @param options  duration in ms, or
 *                 { type, durationMs, action: { label, onClick }, tag, detail, key, onClose }.
 *                 `tag` (a ticket id) and `detail` make a second, quieter line under the message.
 *                 `key`: a toast already showing with the same key is rewritten in place and its
 *                 timer restarted, instead of a second one stacking up. Its type and action stay
 *                 as first shown. `onClose` runs once when the toast goes, however it goes.
 *
 * The second argument used to be a bare duration. Most of the app had moved on
 * to passing `{ type: 'error' }`, which coerced to NaN and dismissed the toast
 * on the next tick — every error toast in the product flashed and disappeared.
 * Both shapes are accepted so neither call style is wrong.
 */
export function showToast(message, options = {}) {
  if (typeof document === 'undefined') return;

  const opts = typeof options === 'number' ? { durationMs: options } : (options || {});
  const {
    type = 'info', durationMs = DEFAULT_MS, action = null, tag = null, detail = null,
    key = null, onClose = null,
  } = opts;

  const stack = getStack();
  // Count only the ones not already on their way out: dismiss() schedules the
  // node removal after the exit transition, so counting children would never
  // see the slot free and would spin here forever.
  const live = () => [...stack.children].filter((child) => !child._toastClosing);

  const same = key != null && live().find((child) => child._toastKey === key);
  if (same) {
    same.replaceChild(messageNode(message, tag, detail), same.querySelector('.toast-msg'));
    same._toastOnClose = onClose;
    same._toastRefresh(durationMs);
    return same._toastDismiss;
  }

  // Full: drop the oldest one nobody is reading. A toast under the pointer or
  // holding focus goes only if every one is held.
  while (live().length >= MAX_VISIBLE) {
    const showing = live();
    dismiss(showing.find((child) => !child._toastHeld) ?? showing[0]);
  }

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el._toastKey = key;
  el._toastOnClose = onClose;
  el.appendChild(messageNode(message, tag, detail));

  if (action?.label && action.onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      dismiss(el);
      action.onClick();
    });
    el.appendChild(btn);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  close.addEventListener('click', () => dismiss(el));
  el.appendChild(close);

  stack.appendChild(el);
  // Next frame, so the browser has a pre-transition state to animate from.
  requestAnimationFrame(() => el.classList.add('on'));

  // Reading is not instant, and a reply worth announcing is worth finishing.
  // Hover or keyboard focus holds the toast; leaving resumes the remainder.
  let remaining = durationMs;
  let startedAt = Date.now();
  const start = (ms) => {
    clearTimeout(el._toastTimer);
    startedAt = Date.now();
    el._toastTimer = setTimeout(() => dismiss(el), ms);
  };
  const resume = () => {
    if (el._toastClosing || !el._toastHeld) return;
    el._toastHeld = false;
    // Coming back from a hover, hand back at least a moment — snapping shut the
    // instant the pointer leaves is its own kind of unreadable.
    start(Math.max(remaining, 1200));
  };
  const pause = () => {
    // Hover and focus can overlap; the second must not take the elapsed time twice.
    if (el._toastHeld) return;
    el._toastHeld = true;
    clearTimeout(el._toastTimer);
    remaining -= Date.now() - startedAt;
  };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);

  // New content, full time again. While held it just waits for the pointer to leave.
  el._toastRefresh = (ms) => {
    remaining = ms;
    if (!el._toastHeld) start(ms);
  };
  el._toastDismiss = () => dismiss(el);
  // The first run honours the caller's duration exactly.
  start(durationMs);

  return el._toastDismiss;
}
