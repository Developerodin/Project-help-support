import {
  getTransitionFieldErrors,
  getValidationDialogForTransitionError,
  isTransitionValidationError,
  logApiError,
  normalizeApiError,
  shouldLogApiError,
} from '@/shared/lib/api-error.js';
import {
  resolveApiErrorDisplay,
  resolveBlockReasonDisplay,
} from '@/shared/lib/transition-error-catalog.js';
import { showToast } from '@/shared/lib/toast.js';

/**
 * Shared transition error routing for board and drawer surfaces.
 */
export async function handleTransitionError(err, options = {}) {
  const {
    ticket,
    onReload,
    setError,
    setFieldErrors,
    setValidationDialog,
    onOpenTicketForValidation,
    logContext,
  } = options;

  const apiError = normalizeApiError(err);
  if (!apiError) return { kind: 'unknown' };

  if (shouldLogApiError(apiError)) {
    logApiError(apiError, logContext);
  }

  if (isTransitionValidationError(apiError)) {
    setFieldErrors?.(getTransitionFieldErrors(apiError, ticket) || {});
    const dialog = getValidationDialogForTransitionError(apiError, ticket);
    setValidationDialog?.(dialog);
    if (dialog && onOpenTicketForValidation) {
      onOpenTicketForValidation(dialog.firstFieldId);
    }
    return { kind: 'validation' };
  }

  if (apiError.status === 409 || apiError.code === 'STAGE_CONFLICT' || apiError.code === 'STALE_REVISION') {
    await onReload?.();
    const display = resolveApiErrorDisplay(apiError);
    if (display?.surface?.toast) {
      showToast(display.message, { type: display.surface.toastType || 'info' });
    }
    return { kind: 'conflict' };
  }

  const display = resolveApiErrorDisplay(apiError);
  if (display?.severity === 'noop') {
    if (display.surface?.toast) {
      showToast(display.message, { type: display.surface.toastType || 'info', durationMs: 3500 });
    }
    return { kind: 'noop' };
  }

  setError?.({
    code: display.code,
    title: display.title,
    message: display.message,
    requestId: display.requestId,
    fields: display.fields,
    status: display.status,
    variant: display.formVariant,
  });
  return { kind: 'error' };
}

/**
 * Client-side board preflight blocks (policy / SAME_STAGE).
 */
export function handleBoardBlockReason(blockReason, { setError, showInfoToast = true } = {}) {
  const display = resolveBlockReasonDisplay(blockReason);
  if (!display) return { kind: 'unknown' };

  if (display.severity === 'noop') {
    if (showInfoToast && display.surface?.toast) {
      showToast(display.message, { type: display.surface.toastType || 'info', durationMs: 3500 });
    }
    return { kind: 'noop' };
  }

  if (display.severity === 'info' && !display.surface?.banner) {
    if (display.surface?.toast) {
      showToast(display.message, { type: 'info', durationMs: 4000 });
    }
    return { kind: 'info' };
  }

  setError?.({
    code: display.code,
    title: display.title,
    message: display.message,
    variant: display.formVariant,
    log: display.logLevel === 'none' ? false : undefined,
  });
  return { kind: display.severity };
}
