import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketComments from '../ticket-comments.jsx';

const ticket = {
  ticketId: 'WEB-101',
  comments: [],
  attachments: [],
};

describe('TicketComments', () => {
  const onAdd = vi.fn();
  const onUpload = vi.fn();

  beforeEach(() => {
    onAdd.mockReset().mockResolvedValue(undefined);
    onUpload.mockReset().mockResolvedValue([]);
  });

  it('uploads pending files without requiring comment text', async () => {
    render(<TicketComments ticket={ticket} onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.click(screen.getByRole('button', { name: /attach files/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('does not post a comment when upload fails', async () => {
    onUpload.mockRejectedValueOnce({
      status: 503,
      code: 'CAPABILITY_DISABLED',
      message: 'File attachments are not configured on this installation',
    });

    render(<TicketComments ticket={ticket} onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'See attached');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not configured/i);
  });

  it('uploads files then posts comment when both are provided', async () => {
    render(<TicketComments ticket={ticket} onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'See attached');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({
      content: 'See attached',
      clientRef: expect.any(String),
    }));
  });
});

