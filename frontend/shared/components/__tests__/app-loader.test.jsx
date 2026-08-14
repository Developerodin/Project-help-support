import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('renders inline variant with custom label', () => {
    render(<AppLoader inline label={LOADING_TICKETS} ariaLabel="Loading tickets" />);

    const status = screen.getByRole('status', { name: 'Loading tickets' });
    expect(status).toHaveClass('app-loader--inline');
    expect(screen.getByText(LOADING_TICKETS)).toBeInTheDocument();
  });
});