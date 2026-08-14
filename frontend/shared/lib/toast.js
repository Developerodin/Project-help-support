/** Minimal toast using `.toast` from design-system.css */
export function showToast(message, durationMs = 3200) {
  if (typeof document === 'undefined') return;

  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.classList.add('on');

  if (el._toastTimer) clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => {
    el.classList.remove('on');
  }, durationMs);
}
