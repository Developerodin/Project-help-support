import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketAttachmentsTab from '../ticket-attachments-tab.jsx';

vi.mock('@/shared/api/tickets.js', () => ({
  resolveAttachmentDownloadUrl: vi.fn().mockResolvedValue('https://example.com/a.png'),
  attachmentDownloadUrl: () => '/x',
}));

const user = { id: 'u1', _id: 'u1', role: 'admin' };

describe('TicketAttachmentsTab', () => {
  it('shows one dropzone that states the empty case, not two dashed boxes', () => {
    render(<TicketAttachmentsTab ticket={{ ticketId: 'WEB-101', attachments: [] }} user={user} canUpload canDelete onUpload={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.queryByText(/no attachments yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.file-drop')).toHaveLength(1);
  });

  it('shows uploader and date on each row', () => {
    render(<TicketAttachmentsTab
      ticket={{
        ticketId: 'WEB-101',
        attachments: [{ id: 'a1', _id: 'a1', name: 'log.txt', size: 2048, uploadedBy: { name: 'Harsh Bansal' }, uploadedAt: '2026-08-18T07:32:00.000Z' }],
      }}
      user={user}
      onUpload={vi.fn()}
      onDelete={vi.fn()}
    />);

    expect(screen.getByText('log.txt')).toBeInTheDocument();
    expect(screen.getByText(/harsh bansal/i)).toBeInTheDocument();
  });

  it('renders uploaded rows with attachment composition', () => {
    render(<TicketAttachmentsTab
      ticket={{
        ticketId: 'WEB-101',
        attachments: [{ id: 'a1', _id: 'a1', name: 'log.txt', size: 2048, uploadedBy: { name: 'Harsh Bansal' }, uploadedAt: '2026-08-18T07:32:00.000Z' }],
      }}
      user={user}
      canUpload
      canDelete
      onUpload={vi.fn()}
      onDelete={vi.fn()}
    />);

    const row = document.querySelector('[data-slot="attachment"][data-state="done"]');
    expect(row).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download log\.txt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete log\.txt/i })).toBeInTheDocument();
  });
});
