export const NEW_TEAM_FIELD_IDS = {
  name: 'ntn',
  project: 'ntp',
};

/** @param {{ name?: string, project?: string, scope?: 'global'|'project' }} draft */
export function validateNewTeamDraft(draft) {
  const errors = [];
  const nameLen = draft.name?.trim().length ?? 0;

  if (nameLen === 0) {
    errors.push({
      field: 'name',
      label: 'Team name',
      message: 'Required.',
      summary: 'Team name',
    });
  }

  // Only reachable from the scope selector: a caller that never sets `scope`
  // (global is the absence of a project) keeps the old single-rule behaviour.
  if (draft.scope === 'project' && !draft.project) {
    errors.push({
      field: 'project',
      label: 'Project',
      message: 'Choose the project this team belongs to.',
      summary: 'Project',
    });
  }

  const first = errors[0];

  return {
    valid: errors.length === 0,
    errors,
    firstFieldId: first ? NEW_TEAM_FIELD_IDS[first.field] : null,
    summaryItems: errors.map((e) => e.summary),
    liveMessage: errors.map((e) => `${e.label}: ${e.message}`).join(' '),
  };
}
