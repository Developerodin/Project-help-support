'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef,
} from 'react';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTicketRealtime } from '@/shared/hooks/use-ticket-realtime.js';

/**
 * ONE SSE connection for the whole app, fanned out to whoever is listening.
 *
 * Pages used to open their own. Two streams to the API origin is already a
 * quarter of the browser's per-origin connection budget spent on sockets that
 * are idle almost all the time, and the ordinary fetches share that budget.
 */
const RealtimeContext = createContext({
  connected: false,
  subscribe: () => () => {},
  publish: () => {},
});

export function RealtimeProvider({ children }) {
  const { activeProjectId } = useProject();
  const handlers = useRef(new Set());

  const onEvent = useCallback((event) => {
    // Copy first: a handler that unsubscribes itself would otherwise mutate the
    // set mid-iteration, and one that throws must not swallow the event for the
    // handlers after it.
    for (const handler of [...handlers.current]) {
      try {
        handler(event);
      } catch {
        // A broken listener is its own problem, not the stream's.
      }
    }
  }, []);

  const { connected } = useTicketRealtime({ projectId: activeProjectId, onEvent });

  const subscribe = useCallback((handler) => {
    handlers.current.add(handler);
    return () => { handlers.current.delete(handler); };
  }, []);

  // The server never echoes a change back to the user who made it (their own
  // screen already knows). A change made outside the screen showing it, like the
  // assistant posting a comment, announces itself here with `self: true`.
  const value = useMemo(() => ({ connected, subscribe, publish: onEvent }), [connected, subscribe, onEvent]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Listen for this component's lifetime without re-subscribing on every render. */
export function useRealtimeEvent(handler) {
  const { subscribe } = useRealtime();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => subscribe((event) => handlerRef.current?.(event)), [subscribe]);
}
