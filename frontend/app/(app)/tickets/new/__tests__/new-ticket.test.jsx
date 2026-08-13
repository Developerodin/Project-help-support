import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewTicketPage from '../page.jsx';

const push = vi.fn();
const listProjects = vi.fn();
const createTicket = vi.fn();
const uploadAttachments = vi.fn();

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
  uploadAttachments: (...a) => uploadAttachments(...a),
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
    uploadAttachments.mockReset().mockResolvedValue([]);
  });

  it('renders the redesigned layout with classification sidebar', async () => {
    render(<NewTicketPage />);

    expect(await screen.findByRole('heading', { name: /new ticket/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /file ticket/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /classification and routing/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /classification/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /where it lands/i })).toBeInTheDocument();
  });

  it('auto-selects the first module and page for WEB projects', async () => {
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await waitFor(() => {
      expect(screen.getByLabelText(/^module/i)).toHaveValue('MAIN');
      expect(screen.getByLabelText(/^page/i)).toHaveValue('Dashboard');
    });
  });

  it('shows Add module when the project has no modules', async () => {
    listProjects.mockResolvedValue({
      results: [
        { id: 'p2', name: 'Mobile App', key: 'MOB', status: 'active', modules: [] },
      ],
    });

    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    const module = screen.getByLabelText(/^module/i);
    expect(module).toBeDisabled();
    expect(module).toHaveDisplayValue('Add module');
    expect(screen.getByRole('link', { name: /configure in projects/i })).toHaveAttribute('href', '/projects');
  });

  it('cascades page when module changes', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await waitFor(() => expect(screen.getByLabelText(/^module/i)).toHaveValue('MAIN'));
    await user.selectOptions(screen.getByLabelText(/^module/i), 'ATS');

    expect(screen.getByLabelText(/^page/i)).toHaveValue('Jobs');
  });

  it('shows validation dialog and inline errors when title is empty', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /fill in required fields/i })).toBeInTheDocument();
    expect(screen.getByText(/title \(min 5 characters\)/i)).toBeInTheDocument();
    expect(screen.getByText(/description \(min 10 characters\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^required\.$/i)).toHaveLength(2);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('shows validation dialog when title is too short', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.type(screen.getByLabelText(/^title/i), 'abc');
    await user.type(screen.getByLabelText(/^description/i), 'long enough description');
    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/title \(min 5 characters\)/i)).toBeInTheDocument();
    expect(document.getElementById('nt-hint')).toHaveTextContent(/at least 5 characters required/i);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('focuses the first invalid field after dismissing the validation dialog', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.click(screen.getByRole('button', { name: /file ticket/i }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: /got it/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^title/i)).toHaveFocus();
    });
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
      module: 'MAIN',
      page: 'Dashboard',
      category: 'Bug',
      severity: 'Major',
      priority: 'Medium',
      environment: 'Staging',
      labels: [],
    }));
    expect(push).toHaveBeenCalledWith('/tickets?ticket=WEB-42');
    expect(uploadAttachments).not.toHaveBeenCalled();
  });

  it('uploads attachments after the ticket is created', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.clear(screen.getByLabelText(/^title/i));
    await user.type(screen.getByLabelText(/^title/i), 'Export drops last row');
    await user.type(screen.getByLabelText(/^description/i), 'Expected all rows in CSV export');

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/add attachments/i), png);
    expect(screen.getByText('shot.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    await waitFor(() => expect(createTicket).toHaveBeenCalled());
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledWith(
      'WEB-42',
      expect.any(FormData),
    ));
    const formData = uploadAttachments.mock.calls[0][1];
    expect([...formData.getAll('files')]).toHaveLength(1);
    expect(push).toHaveBeenCalledWith('/tickets?ticket=WEB-42');
  });

  it('does not block submit when attachments are invalid', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.clear(screen.getByLabelText(/^title/i));
    await user.type(screen.getByLabelText(/^title/i), 'Export drops last row');
    await user.type(screen.getByLabelText(/^description/i), 'Expected all rows in CSV export');

    const bad = new File(['<svg'], 'payload.svg', { type: 'image/svg+xml' });
    const input = screen.getByLabelText(/add attachments/i);
    Object.defineProperty(input, 'files', { configurable: true, value: [bad] });
    fireEvent.change(input);
    expect(await screen.findByText(/payload\.svg: type not allowed/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    await waitFor(() => expect(createTicket).toHaveBeenCalled());
    expect(uploadAttachments).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/tickets?ticket=WEB-42');
  });

  it('removes a selected attachment from the list', async () => {
    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/add attachments/i), png);
    expect(screen.getByText('shot.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove shot\.png/i }));
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();
  });

  it('shows upload loader while attachments upload after create', async () => {
    let resolveUpload;
    uploadAttachments.mockImplementation(() => new Promise((resolve) => {
      resolveUpload = resolve;
    }));

    const user = userEvent.setup();
    render(<NewTicketPage />);
    await screen.findByLabelText(/^project/i);

    await user.clear(screen.getByLabelText(/^title/i));
    await user.type(screen.getByLabelText(/^title/i), 'Export drops last row');
    await user.type(screen.getByLabelText(/^description/i), 'Expected all rows in CSV export');

    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/add attachments/i), png);

    await user.click(screen.getByRole('button', { name: /file ticket/i }));

    await waitFor(() => expect(createTicket).toHaveBeenCalled());
    expect(screen.getByRole('status', { name: /uploading attachment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /uploading/i })).toBeDisabled();

    resolveUpload([]);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets?ticket=WEB-42'));
    expect(screen.queryByRole('status', { name: /uploading attachment/i })).not.toBeInTheDocument();
  });
});
