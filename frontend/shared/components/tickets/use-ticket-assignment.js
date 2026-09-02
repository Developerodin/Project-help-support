'use client';

import { useEffect, useMemo, useState } from 'react';
import { getProject } from '@/shared/api/projects.js';
import { listTeams } from '@/shared/api/teams.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { getUserRoles } from '@pms/shared';
import { capRole } from '@/shared/lib/profile-utils.js';
import { showToast } from '@/shared/lib/toast.js';

function entityRef(entity) {
  if (!entity) return null;
  const id = entity.id || entity._id;
  if (!id) return null;
  return { id: String(id), name: entity.name };
}

export function useTicketAssignment({
  ticket, canAssign, canViewTeams = false, onAssign, eagerLoad = false,
}) {
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [projectTeam, setProjectTeam] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [membersError, setMembersError] = useState(null);
  const [teamsError, setTeamsError] = useState(null);
  const [assigningField, setAssigningField] = useState(null);

  const projectId = ticket?.project?.id || ticket?.project?._id;

  useEffect(() => {
    if (!canAssign || !projectId || (!eagerLoad && !assigneePickerOpen && !teamPickerOpen)) {
      return undefined;
    }
    let cancelled = false;
    setLoadingMembers(true);
    setMembersError(null);
    getProject(projectId)
      .then((project) => {
        if (cancelled) return;
        setProjectTeam(project.team || null);
        setTeamMembers(project.teamMembers || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setMembersError(normalizeApiError(err)?.message || 'Could not load project team');
        }
      })
      .finally(() => { if (!cancelled) setLoadingMembers(false); });
    return () => { cancelled = true; };
  }, [canAssign, assigneePickerOpen, teamPickerOpen, projectId, eagerLoad]);

  useEffect(() => {
    if (!canAssign || !canViewTeams || (!eagerLoad && !teamPickerOpen)) return undefined;
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
  }, [canAssign, canViewTeams, teamPickerOpen, projectId, eagerLoad]);

  const userOptions = useMemo(
    () => teamMembers.map((member) => {
      const globalRoles = member.user?.globalRoles?.length
        ? member.user.globalRoles
        : getUserRoles(member.user);
      return {
        id: String(member.user.id),
        name: member.user.name,
        subtitle: globalRoles.map(capRole).join(', '),
      };
    }),
    [teamMembers],
  );

  const teamOptions = useMemo(() => {
    if (projectTeam) {
      return [{
        id: String(projectTeam.id),
        name: projectTeam.name,
        meta: ticket?.project?.key || 'project',
      }];
    }
    return teams.map((team) => ({
      id: String(team.id || team._id),
      name: team.name,
      meta: team.project?.key || (team.project ? team.project.name : 'global'),
    }));
  }, [teams, projectTeam, ticket?.project?.key]);

  async function submitAssignment(field, patch, successMessage) {
    if (!onAssign || assigningField) return;
    setAssigningField(field);
    try {
      const payload = { ...patch };
      if (field === 'assignee' && projectTeam && !payload.team) {
        payload.team = projectTeam.id;
      }
      await onAssign(payload);
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
    loadingUsers: loadingMembers,
    loadingTeams,
    usersError: membersError,
    teamsError,
    assigningField,
    assigneeValue: entityRef(ticket?.assignedTo),
    teamValue: entityRef(ticket?.team || projectTeam),
    submitAssignment,
    projectTeamLocked: Boolean(projectTeam),
  };
}
