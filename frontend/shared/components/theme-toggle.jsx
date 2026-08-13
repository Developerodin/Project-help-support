'use client';

import { useTheme } from '@/shared/contexts/theme-context.jsx';

function MoonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12.5 9.2A5.5 5.5 0 0 1 6.8 3.5 5.5 5.5 0 1 0 12.5 9.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.2 4.2l.85.85M10.95 10.95l.85.85M11.8 4.2l-.85.85M5.05 10.95l-.85.85"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ThemeToggle() {
  const { isLight, setTheme } = useTheme();

  return (
    <label className="theme-toggle">
      <input
        type="checkbox"
        className="theme-toggle__input"
        checked={isLight}
        onChange={(event) => setTheme(event.target.checked ? 'light' : 'dark')}
        aria-label="Toggle light or dark mode"
        role="switch"
        aria-checked={isLight}
      />
      <span className="theme-toggle__track">
        <span className="theme-toggle__thumb" />
        <span className="theme-toggle__icon theme-toggle__icon--moon">
          <MoonIcon />
        </span>
        <span className="theme-toggle__icon theme-toggle__icon--sun">
          <SunIcon />
        </span>
      </span>
    </label>
  );
}
