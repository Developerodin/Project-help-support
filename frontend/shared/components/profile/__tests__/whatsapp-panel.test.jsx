import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WhatsappPanel from '../whatsapp-panel.jsx';

const api = vi.hoisted(() => ({
  getWhatsappLink: vi.fn(),
  startWhatsappLink: vi.fn(),
  unlinkWhatsapp: vi.fn(),
}));
vi.mock('@/shared/api/whatsapp.js', () => api);

describe('WhatsappPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays hidden when WhatsApp is off for this user', async () => {
    api.getWhatsappLink.mockResolvedValue({ enabled: false });
    const { container } = render(<WhatsappPanel />);
    await vi.waitFor(() => expect(api.getWhatsappLink).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the code to send and opens WhatsApp with it typed in', async () => {
    api.getWhatsappLink.mockResolvedValue({ enabled: true, linked: false });
    api.startWhatsappLink.mockResolvedValue({ code: '12345678', expiresAt: '2026-09-29T10:00:00.000Z', businessNumber: '15551234567' });
    render(<WhatsappPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Link WhatsApp' }));

    expect(screen.getByText('LINK 12345678')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open WhatsApp' }))
      .toHaveAttribute('href', 'whatsapp://send?phone=15551234567&text=LINK%2012345678');
  });

  it('shows the linked number and unlinks', async () => {
    api.getWhatsappLink
      .mockResolvedValueOnce({ enabled: true, linked: true, number: '••••0001', linkedAt: '2026-09-29T10:00:00.000Z' })
      .mockResolvedValue({ enabled: true, linked: false });
    api.unlinkWhatsapp.mockResolvedValue({ linked: false });
    render(<WhatsappPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }));

    expect(api.unlinkWhatsapp).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Link WhatsApp' })).toBeInTheDocument();
  });
});
