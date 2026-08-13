import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttachmentUploadLoader from '../attachment-upload-loader.jsx';

describe('AttachmentUploadLoader', () => {
  it('renders compact variant with accessible status', () => {
    render(<AttachmentUploadLoader />);

    const status = screen.getByRole('status', { name: 'Uploading attachment' });
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('attach-upload-loader--compact');
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(status.querySelectorAll('.attach-upload-loader__dot')).toHaveLength(12);
  });

  it('renders overlay variant with custom label', () => {
    render(<AttachmentUploadLoader variant="overlay" label="Loading…" ariaLabel="Loading files" />);

    const status = screen.getByRole('status', { name: 'Loading files' });
    expect(status).toHaveClass('attach-upload-loader--overlay');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
