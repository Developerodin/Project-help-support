import { describe, it, expect } from 'vitest';
import {
  formatAuditActorWithInitiator,
  formatAuditTarget,
  summariseAuditDetails,
} from '../audit-log-format.js';

describe('formatAuditActorWithInitiator', () => {
  const admin = { id: 'a1', name: 'Administrator', email: 'owner@example.com' };

  it('shows the policy editor by name with their email underneath', () => {
    const row = { action: 'role_matrix.update', actor: admin, initiator: null };
    expect(formatAuditActorWithInitiator(row)).toEqual({
      actor: 'Administrator',
      actorDetail: 'owner@example.com',
      initiator: null,
    });
  });

  it('keeps the initiator line on impersonation rows', () => {
    const row = {
      action: 'security.impersonation.stop',
      actor: { id: 'u2', name: 'Sami Shaikh', email: 'sami@example.com' },
      initiator: admin,
    };
    expect(formatAuditActorWithInitiator(row)).toEqual({
      actor: 'Sami Shaikh',
      actorDetail: 'sami@example.com',
      initiator: 'Administrator',
    });
  });

  it('adds no second line when the email is the only label', () => {
    const row = { action: 'board_permissions.update', actor: { id: 'a1', email: 'owner@example.com' } };
    expect(formatAuditActorWithInitiator(row)).toMatchObject({ actor: 'owner@example.com', actorDetail: null });
  });

  it('falls back to the raw id for an unpopulated actor', () => {
    expect(formatAuditActorWithInitiator({ actor: 'a1' })).toMatchObject({ actor: 'a1', actorDetail: null });
  });
});

const noOpBoardSave = (details) => ({
  action: 'board_permissions.update',
  details: { changeCount: 0, changes: [], ...details },
});

describe('formatAuditTarget for board permission saves', () => {
  it('names the role saved even when nothing changed', () => {
    const row = noOpBoardSave({ roles: ['client'] });
    expect(summariseAuditDetails(row)).toBe('No effective change');
    expect(formatAuditTarget(row)).toBe('Client');
  });

  it('prefers the roles in the diff when there are changes', () => {
    const row = noOpBoardSave({
      roles: ['client'],
      changeCount: 1,
      changes: [{ role: 'developer', board: 'qa', capability: 'operate', before: false, after: true }],
    });
    expect(formatAuditTarget(row)).toBe('Developer');
  });

  it('falls back to a board or project named in the details', () => {
    expect(formatAuditTarget(noOpBoardSave({ board: 'qa' }))).toBe('QA');
    expect(formatAuditTarget({
      ...noOpBoardSave({ projectId: 'p1' }),
      subjectNames: { project: 'Test Mobile' },
    })).toBe('Test Mobile');
  });

  it('keeps the dash for older rows that recorded no subject', () => {
    expect(formatAuditTarget(noOpBoardSave({}))).toBe('—');
  });
});

const ticketRow = (action, details = {}) => ({
  action,
  category: 'ticket',
  ticketId: 'WEB-12',
  details: { ticketId: 'WEB-12', projectKey: 'WEB', title: 'Broken login', ...details },
});

describe('ticket audit rows', () => {
  it('targets the ticket id and prefers the resolved project name', () => {
    const row = { ...ticketRow('ticket.created'), subjectNames: { project: 'Web App' } };
    expect(formatAuditTarget(row)).toBe('WEB-12');
    expect(summariseAuditDetails(row)).toBe('WEB-12 · Web App · Created "Broken login"');
  });

  it('describes a stage change with both stage names', () => {
    const row = ticketRow('ticket.transitioned', { from: 'pending', to: 'in_progress' });
    expect(summariseAuditDetails(row)).toMatch(/^WEB-12 · WEB · Pending to In Progress$/i);
  });

  it('lists field edits with names for people and no raw ids', () => {
    const row = ticketRow('ticket.updated', {
      changes: [
        { field: 'priority', from: 'high', to: 'urgent' },
        { field: 'testedBy', from: null, to: 'u1', toLabel: 'Ada' },
        { field: 'description', from: 'a', to: 'b' },
      ],
    });
    expect(summariseAuditDetails(row)).toBe('WEB-12 · WEB · Priority: high to urgent; Tester: nobody to Ada; +1 more');
  });

  it('names the deleted ticket from its snapshot', () => {
    const row = ticketRow('ticket.deleted', { status: 'pending' });
    expect(summariseAuditDetails(row)).toBe('WEB-12 · WEB · Deleted "Broken login" while in Pending');
  });

  it('never includes an em dash in the ticket summaries', () => {
    const actions = ['ticket.created', 'ticket.blocked', 'ticket.comment_added', 'ticket.attachments_added'];
    for (const action of actions) {
      expect(summariseAuditDetails(ticketRow(action, { files: ['a.png'], reason: 'Waiting on API' }))).not.toContain('—');
    }
  });
});
