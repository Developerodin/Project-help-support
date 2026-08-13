export const THEME_STORAGE_KEY = 'pms-theme';

/** @typedef {'light' | 'dark'} Theme */

/** @returns {Theme} */
export function readStoredTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** @param {Theme} theme */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export const themeInitScript = "(function(){try{var t=localStorage.getItem('pms-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}})();";
