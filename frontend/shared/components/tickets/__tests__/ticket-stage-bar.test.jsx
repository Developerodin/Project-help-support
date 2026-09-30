import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('renders the pipeline with the current stage highlighted', () => {
    render(
      <TicketStageBar ticket={ticket({ status: 'ready_qa' })}
        actor={{ _id: 'u-admin', role: 'admin' }} />,
    );

    expect(screen.getByRole('list', { name: /stage pipeline/i })).toBeInTheDocument();
    expect(document.querySelectorAll('.railseg')).toHaveLength(STAGES.length);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent(/ready for qa/i);
  });

  it('leaves every segment disabled when no onTransition is given', () => {
    render(
      <TicketStageBar ticket={ticket()} actor={{ _id: 'u-dev', role: 'developer' }} />,
    );

    const hits = document.querySelectorAll('.railhit');
    expect(hits).toHaveLength(STAGES.length);
    expect([...hits].every((b) => b.disabled)).toBe(true);
  });

  it('transitions when a legal stage segment is clicked', async () => {
    const onTransition = vi.fn();
    render(
      <TicketStageBar
        ticket={ticket({ status: 'pending' })}
        actor={{ _id: 'u-admin', role: 'admin' }}
        onTransition={onTransition}
      />,
    );

    const target = screen.getByRole('button', { name: /under review/i });
    expect(target).toBeEnabled();
    await userEvent.click(target);

    expect(onTransition).toHaveBeenCalledWith({ to: 'under_review', revision: 0 });
  });

  it('marks the current stage step in the pipeline list', () => {
    render(
      <TicketStageBar ticket={ticket({ status: 'live' })}
        actor={{ _id: 'u-admin', role: 'admin' }} />,
    );

    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current).toHaveTextContent('Live');
  });
});
