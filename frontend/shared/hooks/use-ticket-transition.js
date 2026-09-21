import { useCallback, useState } from 'react';
import { handleTransitionError } from '@/shared/lib/handle-transition-error.js';

/**
 * Shared transition lifecycle: pending flag + catalog-backed error routing.
 */
export function useTicketTransition({
  ticket,
  onReload,
  setError,
  setFieldErrors,
  setValidationDialog,
  onOpenTicketForValidation,
}) {
  const [pendingTicketId, setPendingTicketId] = useState(null);

  const runTransition = useCallback(async (ticketId, operation) => {
    setPendingTicketId(ticketId);
    setError?.(null);
    try {
      await operation();
      await onReload?.();
    } catch (err) {
      await handleTransitionError(err, {
        ticket,
        onReload,
        setError,
        setFieldErrors,
        setValidationDialog,
        onOpenTicketForValidation,
        logContext: { ticketId, surface: 'transition' },
      });
    } finally {
      setPendingTicketId(null);
    }
  }, [
    ticket,
    onReload,
    setError,
    setFieldErrors,
    setValidationDialog,
    onOpenTicketForValidation,
  ]);

  return { pendingTicketId, runTransition };
}
