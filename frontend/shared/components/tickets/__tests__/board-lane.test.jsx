import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LANES } from '@pms/shared';
import BoardLane from '../board-lane.jsx';

const ticket = (over = {}) => ({
  id: 't1', ticketId: 'WEB-1', title: 'Broken login', status: 'pending', ...over,
});

describe('BoardLane', () => {
  it('the lanes are exactly the five defined in shared/stages.js', () => {
    expect(LANES.map((l) => l.key)).toEqual(['intake', 'development', 'qa', 'release', 'done']);
  });

  it('shows the exact stage on each card, not just the lane', () => {
    render(
      <BoardLane lane={LANES[0]} tickets={[ticket({ status: 'under_review' })]}
        onOpen={() => {}} onDropTicket={() => {}} />,
    );

    expect(screen.getByText('Under Review')).toBeInTheDocument();
    expect(screen.getByText('WEB-1')).toBeInTheDocument();
  });

  it('a drop calls back with the lane ENTRY STAGE, not the lane key', () => {
    const onDropTicket = vi.fn();
    render(
      <BoardLane lane={LANES[2]} tickets={[]} onOpen={() => {}} onDropTicket={onDropTicket} />,
    );

    const dropZone = screen.getByTestId('lane-qa');
    const event = Object.assign(new Event('drop', { bubbles: true }), {
      dataTransfer: { getData: () => 'WEB-1' },
      preventDefault: () => {},
    });
    dropZone.dispatchEvent(event);

    expect(onDropTicket).toHaveBeenCalledWith('WEB-1', 'ready_qa');
  });

  it('shows the lane ticket count', () => {
    render(
      <BoardLane lane={LANES[0]}
        tickets={[ticket(), ticket({ id: 't2', ticketId: 'WEB-2' })]}
        onOpen={() => {}} onDropTicket={() => {}} />,
    );

    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
