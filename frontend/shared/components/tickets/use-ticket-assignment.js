'use client';

import { useEffect, useMemo, useState } from 'react';
import { listTeams } from '@/shared/api/teams.js';
import { listUsers } from '@/shared/api/users.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

function entityRef(entity) {
  if (!entity) return null;
  const id = entity.id || entity._id;
  if (!id) return null;
  return { id: String(id), name: entity.name };
}

export function useTicketAssignment({ ticket, canAssign, onAssign, eagerLoad = false }) {
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [usersError, setUsersError] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [assigningField, setAssigningField] = useState(null);

  const projectId = ticket?.project?.id || ticket?.project?._id;

  useEffect(() => {
    if (!canAssign || (!eagerLoad && !assigneePickerOpen)) return undefined;
    let cancelled = false;
    setLoadingUsers(true);
    setUsersError(null);
    listUsers({ status: 'active' })
      .then((page) => { if (!cancelled) setUsers(page.results || []); })
      .catch((err) => {
        if (!cancelled) setUsersError(normalizeApiError(err)?.message || 'Could not load people');
      })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, [canAssign, assigneePickerOpen, eagerLoad]);

  useEffect(() => {
    if (!canAssign || (!eagerLoad && !teamPickerOpen)) return undefined;
    let cancelled = false;
    setLoadingTeams(true);
    setTeamsError(null);
    listTeams(projectId)
      .then((page) => { if (!cancelled) setTeams(page.results || []); })
      .catch((err) => {
        if (!cancelled) setTeamsError(normalizeApiError(err)?.message || 'Could not load teams');
      })
      .finally(() => { if (!cancelled) setLoadingTeams(false); });
    return () => { cancelled = true; };
  }, [canAssign, teamPickerOpen, projectId, eagerLoad]);

  const userOptions = useMemo(
    () => users.map((user) => ({
      id: String(user.id || user._id),
      name: user.name,
      subtitle: user.email,
    })),
    [users],
  );

  const teamOptions = useMemo(
    () => teams.map((team) => ({
      id: String(team.id || team._id),
      name: team.name,
      meta: team.project?.key || (team.project ? team.project.name : 'global'),
    })),
    [teams],
  );

  async function submitAssignment(field, patch, successMessage) {
    if (!onAssign || assigningField) return;
    setAssigningField(field);
    try {
      await onAssign(patch);
      showToast(successMessage);
      if (field === 'assignee') setAssigneePickerOpen(false);
      if (field === 'team') setTeamPickerOpen(false);
    } catch (err) {
      showToast(normalizeApiError(err)?.message || 'Could not update assignment');
      throw err;
    } finally {
      setAssigningField(null);
    }
  }

  return {
    assigneePickerOpen,
    setAssigneePickerOpen,
    teamPickerOpen,
    setTeamPickerOpen,
    userOptions,
    teamOptions,
    loadingUsers,
    loadingTeams,
    usersError,
    teamsError,
    assigningField,
    assigneeValue: entityRef(ticket?.assignedTo),
    teamValue: entityRef(ticket?.team),
    submitAssignment,
  };
}
