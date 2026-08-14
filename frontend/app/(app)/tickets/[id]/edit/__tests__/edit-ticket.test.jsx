import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditTicketPage from '../page.jsx';

const push = vi.fn();
const getTicket = vi.fn();
const patchTicket = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useParams: () => ({ id: 'WEB-101' }),
}));

vi.mock('@/shared/api/tickets.js', () => ({
  getTicket: (...a) => getTicket(...a),
  patchTicket: (...a) => patchTicket(...a),
}));

const ticket = {
  id: 't1',
  ticketId: 'WEB-101',
  title: 'Broken login',
  description: 'Nothing happens when clicking submit',
  stepsToReproduce: '1. Open login\n2. Submit',
  module: 'MAIN',
  page: 'Dashboard',
  category: 'Bug',
  severity: 'Major',
  priority: 'Medium',
  environment: 'Staging',
  labels: ['Regression'],
  revision: 3,
  project: {
    id: 'p1',
    name: 'Web App',
    key: 'WEB',
    modules: [{ label: 'MAIN', pages: [{ label: 'Dashboard', path: '/dashboard' }] }],
  },
};

describe('EditTicketPage', () => {
  beforeEach(() => {
    push.mockReset();
    getTicket.mockReset().mockResolvedValue(ticket);
    patchTicket.mockReset().mockResolvedValue({ ...ticket, revision: 4 });
  });

  it('loads the ticket and pre-fills the form', async () => {
    render(<EditTicketPage />);

    expect(await screen.findByRole('heading', { name: /edit web-101/i })).toBeInTheDocument();
    expect(getTicket).toHaveBeenCalledWith('WEB-101');
    expect(screen.getByLabelText(/^title/i)).toHaveValue('Broken login');
    expect(screen.getByLabelText(/^description/i)).toHaveValue('Nothing happens when clicking submit');
    expect(screen.getByText('Web App')).toBeInTheDocument();
  });

  it('shows validation dialog when title is too short', async () => {
    const user = userEvent.setup();
    render(<EditTicketPage />);
    await screen.findByLabelText(/^title/i);

    await user.clear(screen.getByLabelText(/^title/i));
    await user.type(screen.getByLabelText(/^title/i), 'abc');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(patchTicket).not.toHaveBeenCalled();
  });

  it('patches the ticket and redirects back to the list drawer', async () => {
    const user = userEvent.setup();
    render(<EditTicketPage />);
    await screen.findByLabelText(/^title/i);

    await user.clear(screen.getByLabelText(/^title/i));
    await user.type(screen.getByLabelText(/^title/i), 'Login button fixed');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(patchTicket).toHaveBeenCalledWith('WEB-101', {
      revision: 3,
      title: 'Login button fixed',
      description: 'Nothing happens when clicking submit',
      stepsToReproduce: '1. Open login\n2. Submit',
      module: 'MAIN',
      page: 'Dashboard',
      category: 'Bug',
      severity: 'Major',
      priority: 'Medium',
      environment: 'Staging',
      labels: ['Regression'],
    }));
    expect(push).toHaveBeenCalledWith('/tickets?ticket=WEB-101');
  });
});
