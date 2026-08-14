/** Normalize API/client errors for display — keep support IDs out of primary UI. */

function readMessage(error) {
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return null;
}

/** Flatten ApiClientError, Error, API JSON bodies, and partial mocks into one shape. */
export function normalizeApiError(error) {
  if (!error) return null;

  if (typeof error === 'string') {
    return { message: error.trim() || 'Request failed' };
  }

  const nested = error.error && typeof error.error === 'object' ? error.error : null;
  const status = error.status ?? error.statusCode ?? nested?.status ?? nested?.statusCode;
  const code = error.code ?? nested?.code ?? error.name;
  const fields = error.fields ?? nested?.fields;
  const requestId = error.requestId ?? nested?.requestId;
  const message = readMessage(error)
    ?? readMessage(nested)
    ?? (code && code !== 'Error' ? String(code) : null);

  return {
    status,
    code,
    message: message || (status ? `Request failed (${status})` : 'Request failed'),
    requestId,
    fields,
  };
}

export function logApiError(error, context) {
  const normalized = normalizeApiError(error);
  if (!normalized) return;

  console.error('[PMS]', {
    code: normalized.code ?? null,
    status: normalized.status ?? null,
    message: normalized.message,
    requestId: normalized.requestId ?? null,
    fields: normalized.fields ?? null,
    context: context ?? null,
  });
}

export function attachmentErrorMessage(error) {
  const normalized = normalizeApiError(error);
  if (!normalized) return 'Request failed';
  if (normalized.code === 'CAPABILITY_DISABLED') {
    return normalized.message || 'File storage is not configured on this server';
  }
  return normalized.message || 'Request failed';
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
