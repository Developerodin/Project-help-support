import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketDetailsTab from '../ticket-details-tab.jsx';

const ticket = (over = {}) => ({
  id: 't1',
  ticketId: 'WEB-101',
  title: 'Broken login',
  description: 'Nothing happens on submit',
  status: 'pending',
  priority: 'medium',
  project: { key: 'WEB', name: 'Web App' },
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('TicketDetailsTab', () => {
  it('shows steps to reproduce below description when present', () => {
    render(
      <TicketDetailsTab
        ticket={ticket({
          stepsToReproduce: '1. Open login\n2. Click submit\n3. See error',
        })}
      />,
    );

    expect(screen.getByText('Nothing happens on submit')).toBeInTheDocument();
    expect(screen.getByText(/1\. Open login/)).toBeInTheDocument();
    expect(screen.getByText(/3\. See error/)).toBeInTheDocument();
  });

  it('hides steps to reproduce when empty', () => {
    render(<TicketDetailsTab ticket={ticket({ stepsToReproduce: '' })} />);

    expect(screen.getByText('Nothing happens on submit')).toBeInTheDocument();
    expect(screen.queryByText(/steps to reproduce/i)).not.toBeInTheDocument();
  });

  it('renders assignee and team as static metadata when the user cannot assign', () => {
    render(
      <TicketDetailsTab
        ticket={ticket({
          assignedTo: { id: 'u1', name: 'Jainam Dhruv' },
          team: { id: 't1', name: 'Web Team' },
        })}
      />,
    );

    expect(screen.getByText('Jainam Dhruv')).toBeInTheDocument();
    expect(screen.getByText('Web Team')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.queryByText(/requires permission/i)).not.toBeInTheDocument();
  });

  it('shows Unassigned as text when there is no assignee and the user cannot assign', () => {
    render(<TicketDetailsTab ticket={ticket({ assignedTo: null, team: null })} />);

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('No team')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps assignee editable but shows team as text without a permission error when teams cannot be listed', () => {
    render(
      <TicketDetailsTab
        ticket={ticket({
          assignedTo: null,
          team: { id: 't1', name: 'Web Team' },
        })}
        canAssign
        canViewTeams={false}
        assignment={{
          submitAssignment: async () => {},
          assigneeValue: null,
          teamValue: { id: 't1', name: 'Web Team' },
          userOptions: [],
          teamOptions: [],
          loadingUsers: false,
          loadingTeams: false,
          usersError: null,
          teamsError: 'Requires permission: teams.view',
          assigningField: null,
          projectTeamLocked: true,
        }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Team' })).not.toBeInTheDocument();
    expect(screen.getByText('Web Team')).toBeInTheDocument();
    expect(screen.getByText('Set by project team')).toBeInTheDocument();
    expect(screen.queryByText(/requires permission/i)).not.toBeInTheDocument();
  });

  it('shows assignee and team dropdowns when the user can assign and view teams', () => {
    render(
      <TicketDetailsTab
        ticket={ticket({ assignedTo: null, team: null })}
        canAssign
        canViewTeams
        assignment={{
          submitAssignment: async () => {},
          assigneeValue: null,
          teamValue: null,
          userOptions: [{ id: 'u1', name: 'Ada' }],
          teamOptions: [{ id: 't1', name: 'Web Team' }],
          loadingUsers: false,
          loadingTeams: false,
          usersError: null,
          teamsError: null,
          assigningField: null,
          projectTeamLocked: false,
        }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Team' })).toBeInTheDocument();
  });
});
