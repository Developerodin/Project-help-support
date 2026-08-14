import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemarkDialog from '../remark-dialog.jsx';

describe('RemarkDialog', () => {
  it('renders a themed modal with a full-width textarea', () => {
    render(
      <RemarkDialog
        open
        title="Close WEB-1"
        label="Reason (required to close)"
        value=""
        onChange={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('alertdialog')).toHaveClass('dlg');
    expect(screen.getByRole('presentation')).toHaveClass('dscrim');
    expect(screen.getByLabelText('Reason (required to close)')).toHaveClass('input');
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
  });

  it('enables confirm when text is entered and shows busy state on submit', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <RemarkDialog
        open
        title="Close WEB-1"
        label="Reason (required to close)"
        value="Done"
        onChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
