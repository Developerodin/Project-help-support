function entityId(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return String(ref.id || ref._id || ref);
}

/**
 * Global teams (project == null) are usable on every project.
 * Project-scoped teams are usable only when team.project matches projectId.
 */
export function isTeamUsableOnProject(team, projectId) {
  if (!team) return false;
  const teamProjectId = entityId(team.project);
  if (!teamProjectId) return true;
  return teamProjectId === entityId(projectId);
}

/**
 * Teams eligible for assignment on a project dropdown.
 * Keeps the current assignment visible even when it is out of scope.
 */
export function filterTeamsForProjectAssignment(teams, projectId, assignedTeam = null) {
  const eligible = (teams || []).filter((team) => isTeamUsableOnProject(team, projectId));
  const assignedId = entityId(assignedTeam);
  if (!assignedId) return eligible;

  if (eligible.some((team) => entityId(team) === assignedId)) return eligible;

  const assigned = (teams || []).find((team) => entityId(team) === assignedId) || assignedTeam;
  return assigned ? [...eligible, assigned] : eligible;
}
