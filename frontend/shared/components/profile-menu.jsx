'use client';

import Link from 'next/link';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { initials } from '@/shared/components/icons.jsx';

export default function ProfileMenu() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <Link
      href="/profile"
      id="meAvatar"
      className="avatar avatar-btn"
      aria-label="View profile"
      title={user.name || user.email}
    >
      {initials(user.name || user.email)}
    </Link>
  );
}
