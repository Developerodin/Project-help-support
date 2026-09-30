import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketHeader from '../ticket-header.jsx';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

const ticket = {
  ticketId: 'WEB-101',
  title: 'Broken login',
  priority: 'Medium',
  watchers: [],
};

describe('TicketHeader RBAC actions', () => {
  it('hides Edit and Delete without those permissions', () => {
    render(
      <TicketHeader
        ticket={ticket}
        watching={false}
        onClose={() => {}}
        onToggleWatch={() => {}}
      />,
    );

    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('shows Edit when tickets.edit is granted and hides Delete', () => {
    render(
      <TicketHeader
        ticket={ticket}
        watching={false}
        canEdit
        onClose={() => {}}
        onToggleWatch={() => {}}
      />,
    );

    expect(screen.getByRole('link', { name: /^edit$/i })).toHaveAttribute('href', '/tickets/WEB-101/edit');
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('shows Delete when tickets.delete is granted and hides Edit', async () => {
    const onRequestDelete = vi.fn();
    render(
      <TicketHeader
        ticket={ticket}
        watching={false}
        canDelete
        onRequestDelete={onRequestDelete}
        onClose={() => {}}
        onToggleWatch={() => {}}
      />,
    );

    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });
});
