import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { todayDateKey } from '@pms/shared';
import TicketMetadataRail from '../ticket-metadata-rail.jsx';

const ticket = {
  id: 't1',
  ticketId: 'WEB-101',
  revision: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  estimatedResolutionAt: '2026-08-19T00:00:00.000Z',
  expectedReleaseDate: '2026-08-20T00:00:00.000Z',
  attachments: [],
  stageHistory: [],
};

describe('TicketMetadataRail date validation', () => {
  it('blocks save and shows inline error when release is before resolution', async () => {
    const onSave = vi.fn();

    render(
      <TicketMetadataRail
        ticket={ticket}
        onSave={onSave}
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const releaseInput = document.getElementById('expectedReleaseDate');
    await userEvent.clear(releaseInput);
    await userEvent.type(releaseInput, '2026-08-18');
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/expected release cannot be before resolution estimate/i)).toBeInTheDocument();
    expect(releaseInput).toHaveAttribute('aria-invalid', 'true');
    expect(releaseInput).toHaveAttribute('min', '2026-08-19');
  });

  it('sets max on resolution input from expected release and min to today', () => {
    const today = todayDateKey();

    render(
      <TicketMetadataRail
        ticket={ticket}
        onSave={vi.fn()}
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const resolutionInput = document.getElementById('estimatedResolutionAt');
    expect(resolutionInput).toHaveAttribute('max', '2026-08-20');
    expect(resolutionInput).toHaveAttribute('min', today);
  });

  it('blocks save and shows inline error when resolution is changed to a past date', async () => {
    const onSave = vi.fn();
    const past = '2020-01-01';

    render(
      <TicketMetadataRail
        ticket={ticket}
        onSave={onSave}
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const resolutionInput = document.getElementById('estimatedResolutionAt');
    await userEvent.clear(resolutionInput);
    await userEvent.type(resolutionInput, past);
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/resolution estimate cannot be in the past/i)).toBeInTheDocument();
    expect(resolutionInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('allows blur without error when existing past dates are unchanged', async () => {
    const onSave = vi.fn();
    const pastTicket = {
      ...ticket,
      estimatedResolutionAt: '2020-01-01T00:00:00.000Z',
      expectedReleaseDate: '2020-01-02T00:00:00.000Z',
    };

    render(
      <TicketMetadataRail
        ticket={pastTicket}
        onSave={onSave}
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const resolutionInput = document.getElementById('estimatedResolutionAt');
    await userEvent.click(resolutionInput);
    await userEvent.tab();

    expect(onSave).toHaveBeenCalled();
    expect(screen.queryByText(/cannot be in the past/i)).not.toBeInTheDocument();
  });
});
