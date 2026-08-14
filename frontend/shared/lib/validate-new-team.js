export const NEW_TEAM_FIELD_IDS = {
  name: 'ntn',
};

/** @param {{ name?: string, project?: string }} draft */
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

  const first = errors[0];

  return {
    valid: errors.length === 0,
    errors,
    firstFieldId: first ? NEW_TEAM_FIELD_IDS[first.field] : null,
    summaryItems: errors.map((e) => e.summary),
    liveMessage: errors.map((e) => `${e.label}: ${e.message}`).join(' '),
  };
}
