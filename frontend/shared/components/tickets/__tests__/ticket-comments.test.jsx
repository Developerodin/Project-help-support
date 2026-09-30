import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setAccessToken } from '@/shared/api/client.js';
import TicketComments, {
  bubbleAlign,
  bubbleVariant,
  canDeleteComment,
  canEditComment,
  groupComments,
  isOwnComment,
} from '../ticket-comments.jsx';

const ticket = {
  ticketId: 'WEB-101',
  comments: [],
  attachments: [],
};

describe('TicketComments', () => {
  const onAdd = vi.fn();
  const onUpload = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    onAdd.mockReset().mockResolvedValue(undefined);
    onUpload.mockReset().mockResolvedValue([]);
    onEdit.mockReset().mockResolvedValue(undefined);
    onDelete.mockReset().mockResolvedValue(undefined);
    setAccessToken('token-abc');
    global.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://s3.example/presigned.png' },
    }));
  });

  it('uploads pending files without requiring comment text', async () => {
    render(<TicketComments ticket={ticket} canComment onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.click(screen.getByRole('button', { name: /send comment/i }));

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

    render(<TicketComments ticket={ticket} canComment onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'See attached');
    await userEvent.click(screen.getByRole('button', { name: /send comment/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not configured/i);
  });

  it('uploads files with comment text in one request', async () => {
    render(<TicketComments ticket={ticket} canComment onAdd={onAdd} onUpload={onUpload} />);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/add comment attachments/i), png);
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'See attached');
    await userEvent.click(screen.getByRole('button', { name: /send comment/i }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const form = onUpload.mock.calls[0][0];
    expect(form.get('commentContent')).toBe('See attached');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('uses a compact chat composer with hidden format hint and Enter to send', async () => {
    render(<TicketComments ticket={ticket} canComment onAdd={onAdd} onUpload={onUpload} />);

    expect(screen.queryByText(/up to 10 files/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attach files/i })).toHaveAttribute('title', 'Attach files');
    expect(screen.queryByRole('button', { name: /^comment$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send comment/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/add a comment/i), 'looks fixed{Enter}');

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].content).toBe('looks fixed');
  });

  it('Enter sends but Shift+Enter inserts a real newline in a multi-line field', async () => {
    render(<TicketComments ticket={ticket} canComment onAdd={onAdd} onUpload={onUpload} />);

    const field = screen.getByLabelText(/add a comment/i);
    expect(field.tagName).toBe('TEXTAREA');

    await userEvent.type(field, 'line one{Shift>}{enter}{/Shift}line two');
    expect(field.value).toBe('line one\nline two');
    expect(onAdd).not.toHaveBeenCalled();

    await userEvent.type(field, '{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].content).toBe('line one\nline two');
  });

  it('shows the internal lock in the composer row for internal users only', () => {
    const { unmount } = render(<TicketComments
      ticket={{ ticketId: 'WEB-101', comments: [] }}
      canComment
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
    />);
    expect(screen.getByRole('button', { name: /make internal note/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/internal only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden from the client/i)).not.toBeInTheDocument();
    unmount();

    render(<TicketComments
      ticket={{ ticketId: 'WEB-101', comments: [] }}
      canComment
      user={{ id: 'u2', role: 'client_tester' }}
      onAdd={onAdd}
      onUpload={onUpload}
    />);
    expect(screen.queryByRole('button', { name: /make internal note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /internal note enabled/i })).not.toBeInTheDocument();
  });

  it('toggles internal mode via the lock and updates placeholder and composer styling', async () => {
    render(<TicketComments
      ticket={{ ticketId: 'WEB-101', comments: [] }}
      canComment
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
    />);

    const field = screen.getByLabelText(/add a comment/i);
    expect(field).toHaveAttribute('placeholder', 'Add a comment... Use @ to mention someone.');
    expect(document.querySelector('.composer-row--internal')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /make internal note/i }));

    expect(screen.getByLabelText(/add an internal note/i)).toHaveAttribute('placeholder', 'Add an internal note...');
    expect(screen.getByRole('button', { name: /internal note enabled/i })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.composer-row--internal')).toBeInTheDocument();
  });

  it('sends internal:true when the lock is active', async () => {
    const localOnAdd = vi.fn().mockResolvedValue(undefined);
    render(<TicketComments
      ticket={{ ticketId: 'WEB-101', comments: [] }}
      canComment
      user={{ id: 'u1', role: 'developer' }}
      onAdd={localOnAdd}
      onUpload={onUpload}
    />);

    await userEvent.type(screen.getByLabelText(/add a comment/i), 'internal note');
    await userEvent.click(screen.getByRole('button', { name: /make internal note/i }));
    await userEvent.click(screen.getByRole('button', { name: /comment internally/i }));

    await waitFor(() => expect(localOnAdd).toHaveBeenCalled());
    expect(localOnAdd.mock.calls[0][0].internal).toBe(true);
  });

  it('marks internal comments in the list and leaves public ones unmarked', () => {
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'Public', internal: false, commentedBy: { name: 'Ann' }, createdAt: '2026-08-18T09:00:00.000Z' },
          { _id: 'c2', content: 'Private', internal: true, commentedBy: { name: 'Dev' }, createdAt: '2026-08-18T09:05:00.000Z' },
        ],
      }}
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
    />);

    expect(screen.getAllByText(/^internal$/i)).toHaveLength(1);
    expect(screen.getByText('Private').closest('[data-slot="bubble"]')).toHaveAttribute('data-variant', 'muted');
    expect(screen.getByText('Public').closest('[data-slot="bubble"]')).toHaveAttribute('data-variant', 'secondary');
  });

  it('renders comments as aligned bubbles with grouped consecutive same-author messages', () => {
    const user = { id: 'u1', role: 'developer' };
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'First', internal: false, commentedBy: { id: 'u2', name: 'Ann', role: 'client' }, createdAt: '2026-08-18T09:00:00.000Z' },
          { _id: 'c2', content: 'Second', internal: false, commentedBy: { id: 'u2', name: 'Ann', role: 'client' }, createdAt: '2026-08-18T09:01:00.000Z' },
          { _id: 'c3', content: 'Mine', internal: false, commentedBy: { id: 'u1', name: 'Dev' }, createdAt: '2026-08-18T09:02:00.000Z' },
        ],
      }}
      user={user}
      onAdd={onAdd}
      onUpload={onUpload}
    />);

    const log = screen.getByRole('log', { name: /comments/i });
    // Every message carries its own author header; grouping is by bubble-group.
    expect(within(log).getAllByText('Ann')).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="message"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-slot="bubble-group"]')).toHaveLength(2);

    const ownBubble = screen.getByText('Mine').closest('[data-slot="bubble"]');
    expect(ownBubble).toHaveAttribute('data-variant', 'default');
    expect(ownBubble).toHaveAttribute('data-align', 'end');

    const otherBubble = screen.getByText('First').closest('[data-slot="bubble"]');
    expect(otherBubble).toHaveAttribute('data-variant', 'secondary');
    expect(otherBubble).toHaveAttribute('data-align', 'start');
  });

  it('exposes bubble grouping helpers for variant and alignment', () => {
    const user = { id: 'u1', role: 'developer' };
    const own = { commentedBy: { id: 'u1', role: 'developer' }, internal: false };
    const teammate = { commentedBy: { id: 'u3', role: 'tester' }, internal: false };
    const other = { commentedBy: { id: 'u2', role: 'client' }, internal: false };
    const internal = { commentedBy: { id: 'u2', role: 'client' }, internal: true };

    expect(isOwnComment(own, user)).toBe(true);
    expect(bubbleVariant(own, user)).toBe('default');
    expect(bubbleAlign(own, user)).toBe('end');
    // Same side of the conversation, so the same end of the thread.
    expect(bubbleAlign(teammate, user)).toBe('end');
    expect(bubbleVariant(other, user)).toBe('secondary');
    expect(bubbleAlign(other, user)).toBe('start');
    expect(bubbleVariant(internal, user)).toBe('muted');

    const grouped = groupComments([other, { ...other, _id: 'c2' }, own]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].comments).toHaveLength(2);
  });

  it('keeps both sides on their own end for a watcher who wrote neither message', () => {
    const watcher = { id: 'u9', role: 'admin' };
    const fromTeam = { commentedBy: { id: 'u2', role: 'developer' }, internal: false };
    const fromClient = { commentedBy: { id: 'u3', role: 'client' }, internal: false };

    expect(bubbleAlign(fromTeam, watcher)).toBe('end');
    expect(bubbleAlign(fromClient, watcher)).toBe('start');
  });

  it('puts the client on the right and the team on the left for a client viewer', () => {
    // The external API strips roles, so the client sees every other author as
    // role-less; their own reply must still land on the right.
    const client = { id: 'u3', role: 'client' };
    const own = { commentedBy: { id: 'u3' }, internal: false };
    const fromTeam = { commentedBy: { id: 'u2' }, internal: false };

    expect(bubbleAlign(own, client)).toBe('end');
    expect(bubbleAlign(fromTeam, client)).toBe('start');
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

  it('shows edit and delete on own comments only for the author', () => {
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'Mine', commentedBy: { id: 'u1', name: 'Dev' }, createdAt: '2026-08-18T09:00:00.000Z' },
          { _id: 'c2', content: 'Theirs', commentedBy: { id: 'u2', name: 'Ann' }, createdAt: '2026-08-18T09:01:00.000Z' },
        ],
      }}
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
      canEditComments
      canDeleteComments
      onEdit={onEdit}
      onDelete={onDelete}
    />);

    expect(screen.getByRole('button', { name: /edit comment/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /delete comment/i })).toHaveLength(1);
  });

  it('lets admins delete but not edit another user comment', () => {
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'Theirs', commentedBy: { id: 'u2', name: 'Ann' }, createdAt: '2026-08-18T09:00:00.000Z' },
        ],
      }}
      user={{ id: 'u1', role: 'admin' }}
      onAdd={onAdd}
      onUpload={onUpload}
      canEditComments
      canDeleteComments
      onEdit={onEdit}
      onDelete={onDelete}
    />);

    expect(screen.queryByRole('button', { name: /edit comment/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete comment/i })).toBeInTheDocument();
  });

  it('hides comment actions for other users without admin rights', () => {
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'Theirs', commentedBy: { id: 'u2', name: 'Ann' }, createdAt: '2026-08-18T09:00:00.000Z' },
        ],
      }}
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
      canEditComments
      canDeleteComments
      onEdit={onEdit}
      onDelete={onDelete}
    />);

    expect(screen.queryByRole('button', { name: /edit comment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete comment/i })).not.toBeInTheDocument();
  });

  it('saves an edited comment through onEdit', async () => {
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'Old text', commentedBy: { id: 'u1', name: 'Dev' }, createdAt: '2026-08-18T09:00:00.000Z' },
        ],
      }}
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
      canEditComments
      canDeleteComments
      onEdit={onEdit}
      onDelete={onDelete}
    />);

    await userEvent.click(screen.getByRole('button', { name: /edit comment/i }));
    const field = screen.getByLabelText(/edit comment/i);
    await userEvent.clear(field);
    await userEvent.type(field, 'Updated text');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('c1', { content: 'Updated text' }));
  });

  it('confirms delete and calls onDelete', async () => {
    render(<TicketComments
      ticket={{
        ticketId: 'WEB-101',
        comments: [
          { _id: 'c1', content: 'Remove me', commentedBy: { id: 'u1', name: 'Dev' }, createdAt: '2026-08-18T09:00:00.000Z' },
        ],
      }}
      user={{ id: 'u1', role: 'developer' }}
      onAdd={onAdd}
      onUpload={onUpload}
      canEditComments
      canDeleteComments
      onEdit={onEdit}
      onDelete={onDelete}
    />);

    await userEvent.click(screen.getByRole('button', { name: /delete comment/i }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/remove this comment/i);
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('c1'));
  });

  it('exposes permission helpers aligned with backend rules', () => {
    const own = { commentedBy: { id: 'u1' } };
    const other = { commentedBy: { id: 'u2' } };
    const author = { id: 'u1', role: 'developer' };
    const admin = { id: 'u3', role: 'admin' };
    const viewer = { id: 'u4', role: 'developer' };

    expect(canEditComment(own, author)).toBe(true);
    expect(canEditComment(other, author)).toBe(false);
    expect(canDeleteComment(own, author)).toBe(true);
    expect(canDeleteComment(other, author)).toBe(false);
    expect(canDeleteComment(other, admin)).toBe(true);
    expect(canEditComment(other, admin)).toBe(false);
    expect(canDeleteComment(other, viewer)).toBe(false);
  });
});

