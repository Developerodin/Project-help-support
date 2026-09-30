import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeToggle from '../theme-toggle.jsx';
import { ThemeProvider } from '@/shared/contexts/theme-context.jsx';
import { THEME_STORAGE_KEY, applyTheme } from '@/shared/lib/theme.js';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyTheme('dark');
  });

  it('renders an accessible theme switch defaulting to dark', () => {
    renderToggle();
    const toggle = screen.getByRole('switch', { name: 'Toggle light or dark mode' });
    expect(toggle).not.toBeChecked();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('switches to light mode and persists preference', async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('switch', { name: 'Toggle light or dark mode' }));

    expect(screen.getByRole('switch')).toBeChecked();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});