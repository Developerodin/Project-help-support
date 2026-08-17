export const NEW_PROJECT_FIELD_IDS = {
  clientId: 'npc',
  name: 'npn',
};

/** @param {{ clientId?: string, name?: string, description?: string }} draft */
export function validateNewProjectDraft(draft) {
  const errors = [];

  if (!draft.clientId?.trim()) {
    errors.push({
      field: 'clientId',
      label: 'Company',
      message: 'Required.',
      summary: 'Company',
    });
  }

  const nameLen = draft.name?.trim().length ?? 0;
  if (nameLen === 0) {
    errors.push({
      field: 'name',
      label: 'Project',
      message: 'Required.',
      summary: 'Project',
    });
  }

  const first = errors[0];

  return {
    valid: errors.length === 0,
    errors,
    firstFieldId: first ? NEW_PROJECT_FIELD_IDS[first.field] : null,
    summaryItems: errors.map((e) => e.summary),
    liveMessage: errors.map((e) => `${e.label}: ${e.message}`).join(' '),
  };
}
