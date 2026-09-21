'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '@/shared/lib/env.js';
import { getAccessToken } from '@/shared/api/client.js';
import { AUTHENTICATED, useAuth } from '@/shared/contexts/auth-context.jsx';

/**
 * How often a page still refetches while the stream is up. `connected` only
 * means the socket opened; it is not a promise that frames keep arriving, and a
 * stream that goes quiet (proxy idle-timeout, sleep/resume, a backend restart
 * inside the reconnect gap) would otherwise leave the page stale until the user
 * hits refresh. Slow enough to stay a backstop rather than a second poll loop.
 */
export const REALTIME_BACKSTOP_MS = 60_000;

/**
 * SSE subscription for ticket list/board refresh. EventSource cannot send
 * Authorization headers, so the access token is passed as `access_token`.
 */
export function useTicketRealtime({ enabled = true, projectId = null, onEvent }) {
  const { status: authStatus } = useAuth();
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || authStatus !== AUTHENTICATED) {
      setConnected(false);
      return undefined;
    }

    const token = getAccessToken();
    if (!token) {
      setConnected(false);
      return undefined;
    }

    const url = new URL(`${API_URL}/realtime/stream`);
    url.searchParams.set('access_token', token);
    if (projectId) url.searchParams.set('project', String(projectId));

    const source = new EventSource(url.toString());

    source.onopen = () => setConnected(true);
    source.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        onEventRef.current?.(payload);
      } catch {
        // Ignore comment/heartbeat lines that are not JSON payloads.
      }
    };
    source.onerror = () => {
      setConnected(false);
      // EventSource retries on its own while readyState is CONNECTING, so
      // closing here turns one dropped connection into a permanently dead
      // stream. Only release it once the browser has given up; the page polls
      // while `connected` is false either way.
      if (source.readyState === EventSource.CLOSED) source.close();
    };

    return () => {
      setConnected(false);
      source.close();
    };
  }, [enabled, authStatus, projectId]);

  return { connected };
}
