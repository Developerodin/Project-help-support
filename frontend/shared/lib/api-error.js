/** Normalize API/client errors for display — keep support IDs out of primary UI. */

export function logApiError(error, context) {
  if (!error) return;
  const payload = {
    code: error.code,
    status: error.status,
    message: error.message,
    requestId: error.requestId,
    fields: error.fields,
    context,
  };
  if (error.requestId) {
    console.error('[PMS]', payload);
  } else if (error.message) {
    console.error('[PMS]', payload);
  }
}

export function getTransitionFieldErrors(error, ticket) {
  if (!error) return null;

  if (error.fields && typeof error.fields === 'object') {
    return error.fields;
  }

  if (error.code === 'ESTIMATES_REQUIRED' && ticket) {
    const fields = {};
    if (!ticket.estimatedResolutionAt) {
      fields.estimatedResolutionAt = 'Required before moving to In Progress';
    }
    if (!ticket.expectedReleaseDate) {
      fields.expectedReleaseDate = 'Required before moving to In Progress';
    }
    return Object.keys(fields).length ? fields : null;
  }

  return null;
}

const FIELD_LABELS = {
  estimatedResolutionAt: 'Estimated resolution date',
  expectedReleaseDate: 'Expected release date',
};

export function getValidationDialogForTransitionError(error, ticket) {
  const fieldErrors = getTransitionFieldErrors(error, ticket);
  if (!fieldErrors) return null;

  const items = Object.keys(fieldErrors).map((key) => FIELD_LABELS[key] || key);
  if (!items.length) return null;

  const firstFieldId = fieldErrors.estimatedResolutionAt
    ? 'estimatedResolutionAt'
    : 'expectedReleaseDate';

  if (error.code === 'ESTIMATES_REQUIRED') {
    return {
      title: 'Dates required',
      message: 'Add both dates in Details, save if needed, then try the stage change again.',
      items,
      firstFieldId,
    };
  }

  return {
    title: 'Complete required details',
    message: 'Fix the highlighted fields in Details, then try again.',
    items,
    firstFieldId,
  };
}

export function isTransitionValidationError(error) {
  return error?.code === 'ESTIMATES_REQUIRED' || error?.code === 'OWNERSHIP_REQUIRED';
}

export async function copyErrorId(requestId) {
  if (!requestId || typeof navigator === 'undefined') return false;
  try {
    await navigator.clipboard.writeText(requestId);
    return true;
  } catch {
    return false;
  }
}
