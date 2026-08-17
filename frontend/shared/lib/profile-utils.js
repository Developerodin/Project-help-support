/** Display helpers for the profile page. */
import { ROLE_IDS, ROLE_LABELS } from '@pms/shared';

export function capRole(role) {
  return ROLE_LABELS[role] || 'Unknown Role';
}

export function capStatus(status) {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function maskUserId(id) {
  if (!id) return '';
  const value = String(id);
  if (value.length <= 4) return value;
  return `••••${value.slice(-4)}`;
}

export function isUserOnTeam(team, userId) {
  if (!team || !userId) return false;
  const uid = String(userId);
  const leadId = team.lead?.id || team.lead;
  if (leadId && String(leadId) === uid) return true;
  return (team.members || []).some((member) => String(member?.id || member) === uid);
}

export function filterUserTeams(teams, userId) {
  return (teams || []).filter((team) => isUserOnTeam(team, userId));
}

export function collectProjectsFromTeams(teams) {
  const seen = new Map();
  for (const team of teams || []) {
    for (const project of team.projects || []) {
      const id = project?.id || project?._id;
      if (id && !seen.has(String(id))) {
        seen.set(String(id), {
          id: String(id),
          key: project.key,
          name: project.name,
        });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function canAccessTeams(role) {
  return role === ROLE_IDS.SUPER_ADMIN || role === ROLE_IDS.ADMIN || role === ROLE_IDS.PROJECT_ADMIN;
}

export function canAccessProjects(role) {
  return role === ROLE_IDS.SUPER_ADMIN || role === ROLE_IDS.ADMIN;
}

export function canAccessAdminPanel(role) {
  return role === ROLE_IDS.SUPER_ADMIN || role === ROLE_IDS.ADMIN;
}
