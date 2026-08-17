import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AppLoader from '../app-loader.jsx';

const LOADING = 'Loading\u2026';
const LOADING_TICKETS = 'Loading tickets\u2026';

describe('AppLoader', () => {
  it('renders fullscreen variant with accessible status', () => {
    render(<AppLoader />);

    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('app-loader--fullscreen');
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(status.querySelectorAll('.pl__dot')).toHaveLength(12);
  });

  it('cycles synonymous phrases on the default loader label', () => {
    vi.useFakeTimers();
    render(<AppLoader />);

    expect(screen.getByText(LOADING)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText('Preparing workspace\u2026')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText('Checking session\u2026')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('renders inline variant with custom label', () => {
    render(<AppLoader inline label={LOADING_TICKETS} ariaLabel="Loading tickets" />);

    const status = screen.getByRole('status', { name: 'Loading tickets' });
    expect(status).toHaveClass('app-loader--inline');
    expect(screen.getByText(LOADING_TICKETS)).toBeInTheDocument();
  });
});