import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAGES, LANES } from '@pms/shared';
import TicketStageBar from '../ticket-stage-bar.jsx';

const STAGE_SHORT = {
  pending: 'Pending',
  under_review: 'Review',
  in_progress: 'In Progress',
  ready_local: 'Local',
  ready_qa: 'Ready QA',
  deployed_staging: 'Staging',
  qa_approved: 'QA Approved',
  ready_production: 'Ready Prod',
  live: 'Live',
  closed: 'Closed',
};

const ticket = (over = {}) => ({
  id: 't1', ticketId: 'WEB-1', status: 'pending', revision: 0,
  createdBy: { _id: 'u-reporter' }, assignedTo: { _id: 'u-dev' },
  estimatedResolutionAt: '2026-09-01T00:00:00.000Z',
  expectedReleaseDate: '2026-09-05T00:00:00.000Z',
  ...over,
});

describe('TicketStageBar', () => {
  it('renders grouped lanes and short stage labels with the current one marked', () => {
    render(
      <TicketStageBar ticket={ticket({ status: 'ready_qa' })}
        actor={{ _id: 'u-admin', role: 'admin' }} onTransition={() => {}} />,
    );

    for (const lane of LANES) expect(screen.getByText(lane.label)).toBeInTheDocument();
    for (const stage of STAGES) {
      expect(screen.getByText(STAGE_SHORT[stage.key] || stage.label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Current stage')).toHaveTextContent('Ready QA');
    expect(screen.getByText(/you can't set this/i)).toBeInTheDocument();
  });

  it('offers only destinations canTransition allows for THIS actor', async () => {
    render(
      <TicketStageBar ticket={ticket()} actor={{ _id: 'u-dev', role: 'developer' }}
        onTransition={() => {}} />,
    );

    expect(screen.getByRole('listitem', { name: 'In Progress' })).toBeEnabled();
    expect(screen.getByRole('listitem', { name: 'Live' })).toBeDisabled();
    expect(screen.getByRole('listitem', { name: 'Staging QA Approved' })).toBeDisabled();
  });

  it('an admin sees forward skips including Live', async () => {
    render(
      <TicketStageBar ticket={ticket()} actor={{ _id: 'u-admin', role: 'admin' }}
        onTransition={() => {}} />,
    );

    expect(screen.getByRole('listitem', { name: 'Live' })).toBeEnabled();
  });

  it('a Reopen asks for a note before it will submit', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined);
    render(
      <TicketStageBar ticket={ticket({ status: 'qa_approved' })}
        actor={{ _id: 'u-admin', role: 'admin' }} onTransition={onTransition} />,
    );

    await userEvent.click(screen.getByRole('listitem', { name: 'In Progress' }));

    const dialog = screen.getByRole('alertdialog');
    const field = within(dialog).getByLabelText(/note \(required to reopen\)/i);
    fireEvent.change(field, { target: { value: 'Still failing on Safari' } });
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirm$/i }));

    expect(onTransition).toHaveBeenCalledWith({
      to: 'in_progress', revision: 0, note: 'Still failing on Safari',
    });
  });

  it('Close asks for a reason in a modal before it will submit', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined);
    render(
      <TicketStageBar ticket={ticket({ status: 'live' })}
        actor={{ _id: 'u-admin', role: 'admin' }} onTransition={onTransition} />,
    );

    await userEvent.click(screen.getByRole('listitem', { name: 'Closed' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Close WEB-1')).toBeInTheDocument();
    const field = within(dialog).getByLabelText(/reason \(required to close\)/i);
    expect(field).toHaveClass('input');
    expect(within(dialog).getByRole('button', { name: /^confirm$/i })).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Shipped to prod' } });
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirm$/i }));

    expect(onTransition).toHaveBeenCalledWith({
      to: 'closed', revision: 0, reason: 'Shipped to prod',
    });
  });
});
