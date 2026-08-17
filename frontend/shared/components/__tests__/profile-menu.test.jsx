import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfileMenu from '../profile-menu.jsx';

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
    },
  }),
}));

describe('ProfileMenu', () => {
  it('links the avatar to the profile page', () => {
    render(<ProfileMenu />);

    const link = screen.getByRole('link', { name: /view profile/i });
    expect(link).toHaveAttribute('href', '/profile');
    expect(link).toHaveTextContent('AL');
  });
});
