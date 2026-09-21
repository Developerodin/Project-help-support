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
}

/**
 * @param message  text to show
 * @param options  duration in ms, or { type, durationMs, action: { label, onClick } }.
 *
 * The second argument used to be a bare duration. Most of the app had moved on
 * to passing `{ type: 'error' }`, which coerced to NaN and dismissed the toast
 * on the next tick — every error toast in the product flashed and disappeared.
 * Both shapes are accepted so neither call style is wrong.
 */
export function showToast(message, options = {}) {
  if (typeof document === 'undefined') return;

  const opts = typeof options === 'number' ? { durationMs: options } : (options || {});
  const { type = 'info', durationMs = DEFAULT_MS, action = null } = opts;

  const stack = getStack();
  // Count only the ones not already on their way out: dismiss() schedules the
  // node removal after the exit transition, so counting children would never
  // see the slot free and would spin here forever.
  const live = () => [...stack.children].filter((child) => !child._toastClosing);
  while (live().length >= MAX_VISIBLE) dismiss(live()[0]);

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;

  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = message;
  el.appendChild(text);

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
  close.textContent = '\u00d7';
  close.addEventListener('click', () => dismiss(el));
  el.appendChild(close);

  stack.appendChild(el);
  // Next frame, so the browser has a pre-transition state to animate from.
  requestAnimationFrame(() => el.classList.add('on'));

  // Reading is not instant, and a reply worth announcing is worth finishing.
  // Hover or keyboard focus holds the toast; leaving resumes the remainder.
  let remaining = durationMs;
  let startedAt = Date.now();
  let paused = false;
  const resume = () => {
    if (el._toastClosing) return;
    startedAt = Date.now();
    // Coming back from a hover, hand back at least a moment — snapping shut the
    // instant the pointer leaves is its own kind of unreadable. The first run
    // honours the caller's duration exactly.
    const ms = paused ? Math.max(remaining, 1200) : remaining;
    paused = false;
    el._toastTimer = setTimeout(() => dismiss(el), ms);
  };
  const pause = () => {
    clearTimeout(el._toastTimer);
    remaining -= Date.now() - startedAt;
    paused = true;
  };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);
  resume();

  return () => dismiss(el);
}
