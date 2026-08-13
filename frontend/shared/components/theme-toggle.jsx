'use client';

import { useTheme } from '@/shared/contexts/theme-context.jsx';

export default function ThemeToggle() {
  const { isLight, setTheme } = useTheme();

  return (
    <div className="theme-toggle" title="Switch appearance">
      <div className="theme-toggle__track">
        <input
          type="checkbox"
          id="theme-mode"
          checked={isLight}
          onChange={(event) => setTheme(event.target.checked ? 'light' : 'dark')}
          aria-label="Toggle light or dark mode"
          role="switch"
          aria-checked={isLight}
        />
        <div data-unchecked="Dark" data-checked="Light" aria-hidden="true" />
      </div>
    </div>
  );
}
