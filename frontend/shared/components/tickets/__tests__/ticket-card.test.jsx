import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TicketCard from '../ticket-card.jsx';

const ticket = (over = {}) => ({
  id: 't1', ticketId: 'WEB-1', title: 'Broken login', status: 'pending', ...over,
});

describe('TicketCard blocked-drag UX', () => {
  it('stays draggable at the DOM level even when this specific card cannot be dragged, so onDragStart can fire and explain why', () => {
    const onBlockedDrag = vi.fn();
    render(
      <TicketCard
        ticket={ticket()}
        onOpen={() => {}}
        draggable
        canDrag={false}
        onBlockedDrag={onBlockedDrag}
      />,
    );

    const card = screen.getByRole('button', { name: /WEB-1/i });
    expect(card).toHaveAttribute('draggable', 'true');

    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.assign(dragStart, { dataTransfer: { setData: vi.fn() } });
    fireEvent(card, dragStart);

    expect(onBlockedDrag).toHaveBeenCalledWith(ticket());
    expect(dragStart.defaultPrevented).toBe(true);
  });

  it('is not draggable at the DOM level when the whole board is not interactive', () => {
    render(
      <TicketCard
        ticket={ticket()}
        onOpen={() => {}}
        draggable={false}
        canDrag={false}
        onBlockedDrag={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /WEB-1/i })).toHaveAttribute('draggable', 'false');
  });

  it('shows the card-locked affordance driven by canDrag, independent of the DOM draggable attribute', () => {
    render(
      <TicketCard ticket={ticket()} onOpen={() => {}} draggable canDrag={false} />,
    );

    expect(screen.getByRole('button', { name: /WEB-1/i })).toHaveClass('card-locked');
  });

  it('drags normally and does not call onBlockedDrag when canDrag is true', () => {
    const onBlockedDrag = vi.fn();
    render(
      <TicketCard ticket={ticket()} onOpen={() => {}} draggable canDrag onBlockedDrag={onBlockedDrag} />,
    );

    const card = screen.getByRole('button', { name: /WEB-1/i });
    expect(card).not.toHaveClass('card-locked');

    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.assign(dragStart, { dataTransfer: { setData: vi.fn() } });
    fireEvent(card, dragStart);

    expect(onBlockedDrag).not.toHaveBeenCalled();
    expect(dragStart.defaultPrevented).toBe(false);
  });
});
