import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UiQaDrawerFooter from '../ui-qa-drawer-footer.jsx';

describe('UiQaDrawerFooter', () => {
  it('shows In Progress as the forward action from review', () => {
    render(<UiQaDrawerFooter status="review" onTransition={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Move to In Progress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move to Review' })).not.toBeInTheDocument();
  });

  it('does not call onTransition when target equals current status', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<UiQaDrawerFooter status="review" onTransition={onTransition} />);

    const button = screen.getByRole('button', { name: 'Move to In Progress' });
    await user.click(button);

    expect(onTransition).toHaveBeenCalledWith({ status: 'in_progress' });
    expect(onTransition).not.toHaveBeenCalledWith({ status: 'review' });
  });

  it('shows no forward move from done', () => {
    render(<UiQaDrawerFooter status="done" onTransition={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Move to / })).not.toBeInTheDocument();
    expect(screen.getByText(/No forward move is available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reopen → Open/ })).toBeInTheDocument();
  });
});
