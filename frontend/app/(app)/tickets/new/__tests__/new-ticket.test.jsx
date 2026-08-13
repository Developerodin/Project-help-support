import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTicketPage from '../page.jsx';

const push = vi.fn();
const listProjects = vi.fn();
const createTicket = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}));

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({ activeProjectId: null }),
}));

vi.mock('@/shared/api/projects.js', () => ({
  listProjects: (...a) => listProjects(...a),
}));

vi.mock('@/shared/api/tickets.js', () => ({
  createTicket: (...a) => createTicket(...a),
}));

describe('NewTicketPage', () => {
  beforeEach(() => {
    push.mockReset();
    listProjects.mockReset().mockResolvedValue({
      results: [
        { id: 'p1', name: 'Web App', key: 'WEB', status: 'active', modules: [] },
      ],
    });
    createTicket.mockReset().mockResolvedValue({ ticketId: 'WEB-42' });
  });

  it('renders the redesigned layout with classification sidebar', async () => {
    render(<NewTicketPage />);

    expect(await screen.findByRole('heading', { name: /new ticket/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /file ticket/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /classification and routing/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /classification/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /where it lands/i })).toBeInTheDocument();
  });

  it('keeps module and page as compact dropdowns', async () => {
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    const module = screen.getByLabelText(/^module/i);
    const page = screen.getByLabelText(/^page/i);

    expect(module.tagName).toBe('SELECT');
    expect(page.tagName).toBe('SELECT');
    expect(module).not.toHaveAttribute('size');
    expect(page).not.toHaveAttribute('size');
    expect(module).not.toHaveAttribute('multiple');
  });

  it('shows validation when title is too short', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.type(screen.getByLabelText(/^title/i), 'abc');
    await user.type(screen.getByLabelText(/^description/i), 'long enough description');
    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    expect(await screen.findByText(/at least 5 characters required/i)).toBeInTheDocument();
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('submits the create payload with Dharwin fields', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.clear(screen.getByLabelText(/^title/i));
    await user.type(screen.getByLabelText(/^title/i), 'Export drops last row');
    await user.type(screen.getByLabelText(/^description/i), 'Expected all rows in CSV export');
    await user.type(screen.getByLabelText(/^steps to reproduce/i), '1. Export\n2. Open file');
    await user.selectOptions(screen.getByLabelText(/^category/i), 'Bug');
    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    await waitFor(() => expect(createTicket).toHaveBeenCalledWith({
      project: 'p1',
      title: 'Export drops last row',
      description: 'Expected all rows in CSV export',
      stepsToReproduce: '1. Export\n2. Open file',
      module: undefined,
      page: undefined,
      category: 'Bug',
      severity: 'Major',
      priority: 'Medium',
      environment: 'Staging',
      labels: [],
    }));
    expect(push).toHaveBeenCalledWith('/tickets?ticket=WEB-42');
  });
});
