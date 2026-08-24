'use client';

import { TicketPreferencesProvider } from '@/shared/contexts/ticket-preferences-context.jsx';

export default function TicketsLayout({ children }) {
  return <TicketPreferencesProvider>{children}</TicketPreferencesProvider>;
}
