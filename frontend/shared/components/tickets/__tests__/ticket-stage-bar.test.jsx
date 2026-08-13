import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAGES } from '@pms/shared';
import TicketStageBar from '../ticket-stage-bar.jsx';

const ticket = (over = {}) => ({
  id: 't1', ticketId: 'WEB-1', status: 'pending', revision: 0,
  createdBy: 'u-reporter', assignedTo: 'u-dev',
  estimatedResolutionAt: '2026-09-01T00:00:00.000Z',
  expectedReleaseDate: '2026-09-05T00:00:00.000Z',
  ...over,
});

describe('TicketStageBar', () => {
  it('renders all ten stops with the current one marked', () => {
    render(
      <TicketStageBar ticket={ticket({ status: 'ready_qa' })}
        actor={{ _id: 'u-admin', role: 'admin' }} onTransition={() => {}} />,
    );

    for (const stage of STAGES) expect(screen.getByText(stage.label)).toBeInTheDocument();
    expect(screen.getByLabelText('Current stage')).toHaveTextContent('Ready for QA');
  });

  it('offers only destinations canTransition allows for THIS actor', async () => {
    render(
      <TicketStageBar ticket={ticket()} actor={{ _id: 'u-dev', role: 'developer' }}
        onTransition={() => {}} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));

    // A developer who is the assignee may start work, and may do nothing else.
    expect(screen.getByRole('menuitem', { name: 'In Progress' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Live' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Staging QA Approved' })).not.toBeInTheDocument();
  });

  it('an admin sees forward skips including Live', async () => {
    render(
      <TicketStageBar ticket={ticket()} actor={{ _id: 'u-admin', role: 'admin' }}
        onTransition={() => {}} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));
    expect(screen.getByRole('menuitem', { name: 'Live' })).toBeInTheDocument();
  });

  it('a Reopen asks for a note before it will submit', async () => {
    const onTransition = vi.fn();
    render(
      <TicketStageBar ticket={ticket({ status: 'qa_approved' })}
        actor={{ _id: 'u-admin', role: 'admin' }} onTransition={onTransition} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /move to/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/note/i), 'Still failing on Safari');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onTransition).toHaveBeenCalledWith({
      to: 'in_progress', revision: 0, note: 'Still failing on Safari',
    });
  });
});
