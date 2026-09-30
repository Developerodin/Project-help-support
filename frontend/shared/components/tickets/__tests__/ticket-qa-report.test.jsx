import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketDrawerFooter from '../ticket-drawer-footer.jsx';
import TicketQaReport, { qaRejections } from '../ticket-qa-report.jsx';

vi.mock('@/shared/api/tickets.js', () => ({
  resolveAttachmentDownloadUrl: vi.fn().mockResolvedValue('https://example.test/shot.png'),
}));

const admin = { _id: 'u-admin', id: 'u-admin', role: 'admin' };

const ticket = (over = {}) => ({
  id: 't1',
  ticketId: 'WEB-1',
  status: 'ready_qa',
  revision: 2,
  createdBy: { _id: 'u-reporter' },
  assignedTo: { _id: 'u-dev' },
  team: { _id: 'team-1' },
  estimatedResolutionAt: '2026-09-01T00:00:00.000Z',
  expectedReleaseDate: '2026-09-05T00:00:00.000Z',
  stageHistory: [],
  ...over,
});

describe('the backward move is a Reject inside the QA lane', () => {
  it('labels it Reject and asks for a QA report from a QA-lane stage', async () => {
    render(<TicketDrawerFooter ticket={ticket({ status: 'deployed_staging' })}
      actor={admin} onTransition={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/Reject WEB-1/i);
    expect(screen.getByLabelText(/QA report \(required to reject\)/i)).toBeInTheDocument();
  });

  it('labels it Reopen everywhere else', async () => {
    render(<TicketDrawerFooter ticket={ticket({ status: 'live' })}
      actor={admin} onTransition={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^reopen$/i }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/Reopen WEB-1/i);
    expect(screen.getByLabelText(/Note \(required to reopen\)/i)).toBeInTheDocument();
  });

  it('sends the note and the chosen image to the transition handler', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined);
    render(<TicketDrawerFooter ticket={ticket()} actor={admin} onTransition={onTransition} />);

    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    await userEvent.type(
      screen.getByLabelText(/QA report \(required to reject\)/i),
      'Login breaks on Safari',
    );

    const shot = new File(['x'], 'shot.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/attach a screenshot/i), shot);
    expect(await screen.findByText('shot.png')).toBeInTheDocument();

    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    await waitFor(() => expect(onTransition).toHaveBeenCalledWith({
      to: 'in_progress',
      revision: 2,
      note: 'Login breaks on Safari',
      image: shot,
    }));
  });

  it('refuses a non-image file instead of sending it', async () => {
    const onTransition = vi.fn();
    render(<TicketDrawerFooter ticket={ticket()} actor={admin} onTransition={onTransition} />);

    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));

    // Straight to change: the input's `accept` already filters what the OS
    // dialog offers, and userEvent honours it. This is the JS backstop for a
    // file that gets past it.
    fireEvent.change(screen.getByLabelText(/attach a screenshot/i), {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/pick an image file/i);
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });
});

describe('TicketQaReport', () => {
  const rejected = {
    id: 's1', from: 'ready_qa', to: 'in_progress', at: '2026-08-19T12:00:00.000Z',
    by: { id: 'u-qa', name: 'Harsh Bansal' }, decision: 'rejected',
    note: 'Login breaks on Safari',
    attachments: [{ _id: 'att1', name: 'shot.png', size: 2048, mimeType: 'image/png' }],
  };

  it('lists only rejections, newest first', () => {
    const older = { ...rejected, id: 's0', note: 'First pass failed' };
    const forward = { id: 's2', from: 'in_progress', to: 'ready_qa', at: 'z', decision: null };

    expect(qaRejections(ticket({ stageHistory: [older, forward, rejected] })).map((e) => e.id))
      .toEqual(['s1', 's0']);
  });

  it('shows the message, the image and who filed it', () => {
    render(<TicketQaReport ticket={ticket({ stageHistory: [rejected] })} />);

    expect(screen.getByText('Login breaks on Safari')).toBeInTheDocument();
    expect(screen.getByText('Harsh Bansal')).toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeInTheDocument();
    expect(screen.getByText(/internal team only/i)).toBeInTheDocument();
  });

  it('says so when QA has never rejected the ticket', () => {
    render(<TicketQaReport ticket={ticket()} />);
    expect(screen.getByText(/has not rejected/i)).toBeInTheDocument();
  });
});
