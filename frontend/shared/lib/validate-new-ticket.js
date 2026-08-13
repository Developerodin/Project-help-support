export const NEW_TICKET_FIELD_IDS = {
  project: 'np',
  title: 'nt',
  description: 'nd',
};

/** @param {{ project?: string, title?: string, description?: string }} draft */
export function validateNewTicketDraft(draft) {
  const errors = [];

  if (!draft.project?.trim()) {
    errors.push({
      field: 'project',
      label: 'Project',
      message: 'Select a project.',
      summary: 'Project',
    });
  }

  const titleLen = draft.title?.trim().length ?? 0;
  if (titleLen < 5) {
    errors.push({
      field: 'title',
      label: 'Title',
      message: titleLen === 0
        ? 'Required.'
        : 'At least 5 characters required.',
      summary: 'Title (min 5 characters)',
    });
  }

  const descLen = draft.description?.trim().length ?? 0;
  if (descLen < 10) {
    errors.push({
      field: 'description',
      label: 'Description',
      message: descLen === 0
        ? 'Required.'
        : 'At least 10 characters required.',
      summary: 'Description (min 10 characters)',
    });
  }

  const first = errors[0];

  return {
    valid: errors.length === 0,
    errors,
    firstFieldId: first ? NEW_TICKET_FIELD_IDS[first.field] : null,
    summaryItems: errors.map((e) => e.summary),
    liveMessage: errors.map((e) => `${e.label}: ${e.message}`).join(' '),
  };
}
