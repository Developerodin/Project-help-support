export const NAV_COLLAPSED_KEY = 'pms-nav-collapsed';

/** @returns {boolean} */
export function readNavCollapsed() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** @param {boolean} collapsed */
export function storeNavCollapsed(collapsed) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}
