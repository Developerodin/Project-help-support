import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setAccessToken } from '@/shared/api/client.js';
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
    setAccessToken('token-abc');
    global.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://s3.example/presigned.png' },
    }));
  });

  it('uploads pending files without requiring comment text', async () => {
    render(<TicketComments ticket={ticket} onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.click(screen.getByRole('button', { name: /attach files/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const form = onUpload.mock.calls[0][0];
    expect(form.get('commentContent')).toBe('shot.png');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('does not post a separate comment when upload fails', async () => {
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

  it('uploads files with comment text in one request', async () => {
    render(<TicketComments ticket={ticket} onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'See attached');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const form = onUpload.mock.calls[0][0];
    expect(form.get('commentContent')).toBe('See attached');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('renders attachments inline on their comment', async () => {
    render(
      <TicketComments
        ticket={{
          ticketId: 'WEB-101',
          comments: [{
            id: 'c1',
            content: 'See attached',
            commentedBy: { name: 'Alex' },
            createdAt: '2026-08-14T10:00:00.000Z',
            attachments: [{ id: 'a1', name: 'shot.png', mimeType: 'image/png', size: 1024 }],
          }],
        }}
        onAdd={onAdd}
        onUpload={onUpload}
      />,
    );

    expect(screen.getByText('See attached')).toBeInTheDocument();
    const preview = await screen.findByRole('button', { name: /shot\.png/i });
    expect(preview).toHaveClass('attach-img');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });
});

