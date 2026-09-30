import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketHistory from '../ticket-history.jsx';

const ticket = {
  activityLog: [
    { _id: 'a1', action: 'created', performedBy: { name: 'Harsh Bansal' }, at: '2026-08-18T07:32:00.000Z' },
    { _id: 'a2', action: 'assigned', performedBy: { name: 'Prakhar Sharma' }, at: '2026-08-18T08:14:00.000Z', changes: [{ field: 'assignedTo', to: 'Harsh Bansal' }] },
  ],
  stageHistory: [
    { _id: 's1', from: 'pending', to: 'under_review', by: { name: 'Administrator' }, at: '2026-08-18T08:29:00.000Z' },
  ],
  comments: [],
};

describe('TicketHistory', () => {
  it('renders activityLog events, not only stage changes', () => {
    render(<TicketHistory ticket={ticket} />);
    expect(screen.getByText('Moved Pending → Under Review')).toBeInTheDocument();
    expect(screen.getByText('Assigned to Harsh Bansal')).toBeInTheDocument();
    expect(screen.getByText('Opened this ticket')).toBeInTheDocument();
  });

  it('orders newest first and names the actor on every row', () => {
    render(<TicketHistory ticket={ticket} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Administrator')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Harsh Bansal')).toBeInTheDocument();
  });

  it('shows an empty state when the viewer receives no activity', () => {
    render(<TicketHistory ticket={{ activityLog: [], stageHistory: [], comments: [] }} />);
    expect(screen.getByText(/no activity to show/i)).toBeInTheDocument();
  });

  it('turns a comment marker into a control that opens Discussion', async () => {
    const onOpenDiscussion = vi.fn();
    render(<TicketHistory
      ticket={{ activityLog: [], stageHistory: [], comments: [{ _id: 'c1', commentedBy: { name: 'Ann' }, createdAt: '2026-08-18T09:00:00.000Z', content: 'Looks good to me' }] }}
      onOpenDiscussion={onOpenDiscussion}
    />);
    expect(screen.getByText(/looks good to me/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /commented/i }));
    expect(onOpenDiscussion).toHaveBeenCalledTimes(1);
  });

  it('expands operation-grouped changes on demand', async () => {
    const run = {
      activityLog: [{
        _id: 'r1',
        action: 'updated',
        performedBy: { name: 'Ann' },
        at: '2026-08-18T10:01:00.000Z',
        changes: [
          { field: 'priority', from: 'low', to: 'high' },
          { field: 'severity', from: 'minor', to: 'major' },
        ],
      }],
      stageHistory: [],
      comments: [],
    };
    render(<TicketHistory ticket={run} onOpenDiscussion={() => {}} />);

    const toggle = screen.getByRole('button', { name: /updated ticket · 2 changes/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/priority: low → high/i)).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/priority: low → high/i)).toBeInTheDocument();
    expect(screen.getByText(/severity: minor → major/i)).toBeInTheDocument();
  });

  it('exposes an exact timestamp on each row', () => {
    render(<TicketHistory ticket={ticket} />);
    const time = screen.getAllByRole('listitem')[0].querySelector('time');
    expect(time).toBeTruthy();
    expect(time.getAttribute('dateTime')).toBe('2026-08-18T08:29:00.000Z');
  });
});
