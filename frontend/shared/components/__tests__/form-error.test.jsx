import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import FormError from '../form-error.jsx';

describe('FormError logging', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips console logging for suppressed client errors', async () => {
    render(<FormError error={{ code: 'CLIENT_BOARD_MOVE_FORBIDDEN', message: 'Nope' }} />);
    await waitFor(() => {
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  it('renders info variant without alert role', () => {
    const { container } = render(
      <FormError
        error={{ code: 'TICKET_BLOCKED', message: 'Blocked', variant: 'info' }}
        title="Ticket is blocked"
        variant="info"
      />,
    );
    const banner = container.querySelector('.banner--info');
    expect(banner).toBeTruthy();
    expect(banner).toHaveAttribute('role', 'status');
  });
});
