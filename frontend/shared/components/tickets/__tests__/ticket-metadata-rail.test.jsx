import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { todayDateKey } from '@pms/shared';
import TicketMetadataRail from '../ticket-metadata-rail.jsx';

// Relative to "now" so the fixture never rots as the wall clock advances past
// hardcoded literals (see backend ticket.patch.test.js for the same pattern).
const dayKey = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const resolutionDateKey = dayKey(10);
const releaseDateKey = dayKey(11);
const releaseBeforeResolutionKey = dayKey(5);

const ticket = {
  id: 't1',
  ticketId: 'WEB-101',
  revision: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  estimatedResolutionAt: `${resolutionDateKey}T00:00:00.000Z`,
  expectedReleaseDate: `${releaseDateKey}T00:00:00.000Z`,
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
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const releaseInput = document.getElementById('expectedReleaseDate');
    await userEvent.clear(releaseInput);
    await userEvent.type(releaseInput, releaseBeforeResolutionKey);
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/expected release cannot be before resolution estimate/i)).toBeInTheDocument();
    expect(releaseInput).toHaveAttribute('aria-invalid', 'true');
    expect(releaseInput).toHaveAttribute('min', resolutionDateKey);
  });

  it('sets max on resolution input from expected release and min to today', () => {
    const today = todayDateKey();

    render(
      <TicketMetadataRail
        ticket={ticket}
        onSave={vi.fn()}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const resolutionInput = document.getElementById('estimatedResolutionAt');
    expect(resolutionInput).toHaveAttribute('max', releaseDateKey);
    expect(resolutionInput).toHaveAttribute('min', today);
  });

  it('blocks save and shows inline error when resolution is changed to a past date', async () => {
    const onSave = vi.fn();
    const past = '2020-01-01';

    render(
      <TicketMetadataRail
        ticket={ticket}
        onSave={onSave}
        canEditEstimates
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
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const resolutionInput = document.getElementById('estimatedResolutionAt');
    await userEvent.click(resolutionInput);
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText(/cannot be in the past/i)).not.toBeInTheDocument();
  });

  it('sends only changed estimate fields on save', async () => {
    const onSave = vi.fn();

    render(
      <TicketMetadataRail
        ticket={ticket}
        onSave={onSave}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const releaseInput = document.getElementById('expectedReleaseDate');
    const nextRelease = dayKey(15);
    await userEvent.clear(releaseInput);
    await userEvent.type(releaseInput, nextRelease);
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledWith({
      revision: ticket.revision,
      expectedReleaseDate: nextRelease,
    });
  });
  it('saves the first resolution estimate on a ticket that has none', async () => {
    const onSave = vi.fn();

    render(
      <TicketMetadataRail
        ticket={{ ...ticket, estimatedResolutionAt: null, expectedReleaseDate: null }}
        onSave={onSave}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const next = dayKey(12);
    await userEvent.type(document.getElementById('estimatedResolutionAt'), next);
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledWith({ revision: ticket.revision, estimatedResolutionAt: next });
  });
  it('saves the first expected release on a ticket that has none', async () => {
    const onSave = vi.fn();

    render(
      <TicketMetadataRail
        ticket={{ ...ticket, estimatedResolutionAt: null, expectedReleaseDate: null }}
        onSave={onSave}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const next = dayKey(12);
    await userEvent.type(document.getElementById('expectedReleaseDate'), next);
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledWith({ revision: ticket.revision, expectedReleaseDate: next });
  });

  it('saves first expected release when date picker commits on blur', async () => {
    const onSave = vi.fn();

    render(
      <TicketMetadataRail
        ticket={{ ...ticket, estimatedResolutionAt: null, expectedReleaseDate: null }}
        onSave={onSave}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const releaseInput = document.getElementById('expectedReleaseDate');
    const next = dayKey(12);
    releaseInput.value = next;
    fireEvent.blur(releaseInput);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ revision: ticket.revision, expectedReleaseDate: next });
    });
  });

  it('shows saving then saved feedback while persisting estimate dates', async () => {
    let resolveSave;
    const onSave = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));

    render(
      <TicketMetadataRail
        ticket={{ ...ticket, estimatedResolutionAt: null, expectedReleaseDate: null }}
        onSave={onSave}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const releaseInput = document.getElementById('expectedReleaseDate');
    const next = dayKey(12);
    releaseInput.value = next;
    fireEvent.blur(releaseInput);

    expect(screen.getByRole('status')).toHaveTextContent(/saving estimate dates/i);
    await waitFor(() => expect(releaseInput).toBeDisabled());

    resolveSave();
    expect(await screen.findByRole('status')).toHaveTextContent(/estimate dates saved/i);
    await waitFor(() => expect(releaseInput).not.toBeDisabled());
  });

  it('shows error feedback and recovers on the next successful retry', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not save estimate dates right now'))
      .mockResolvedValueOnce(undefined);

    render(
      <TicketMetadataRail
        ticket={{ ...ticket, estimatedResolutionAt: null, expectedReleaseDate: null }}
        onSave={onSave}
        canEditEstimates
        blockReason=""
        setBlockReason={vi.fn()}
      />,
    );

    const releaseInput = document.getElementById('expectedReleaseDate');
    releaseInput.value = dayKey(12);
    fireEvent.blur(releaseInput);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save estimate dates right now/i);
    expect(releaseInput).not.toBeDisabled();

    releaseInput.value = dayKey(13);
    fireEvent.blur(releaseInput);

    expect(await screen.findByRole('status')).toHaveTextContent(/estimate dates saved/i);
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
