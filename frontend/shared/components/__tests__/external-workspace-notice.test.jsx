import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExternalWorkspaceNotice from '../external-workspace-notice.jsx';

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: vi.fn(),
}));

import { useProject } from '@/shared/contexts/project-context.jsx';

describe('ExternalWorkspaceNotice', () => {
  it('shows a non-blocking notice for unassigned external users', () => {
    useProject.mockReturnValue({ hasWorkspace: false, loading: false });

    render(<ExternalWorkspaceNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('No workspace assigned');
    expect(screen.getByText(/haven't been assigned to a company or project yet/i)).toBeInTheDocument();
  });

  it('renders nothing when external user has project access', () => {
    useProject.mockReturnValue({ hasWorkspace: true, loading: false });

    const { container } = render(<ExternalWorkspaceNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while projects are loading', () => {
    useProject.mockReturnValue({ hasWorkspace: false, loading: true });

    const { container } = render(<ExternalWorkspaceNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
