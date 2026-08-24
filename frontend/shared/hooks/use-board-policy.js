'use client';

import { useEffect, useState } from 'react';
import { buildBoardRolePolicy, recordToBoardPolicy } from '@pms/shared';
import { getBoardPermissionsEffective } from '../api/rbac.js';

/**
 * Load the effective board-role policy once per session. Falls back to code
 * baseline when the API is unreachable (deny-by-default is enforced server-side).
 */
export function useBoardPolicy() {
  const [policy, setPolicy] = useState(() => buildBoardRolePolicy());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getBoardPermissionsEffective();
        if (!cancelled && data?.effective) {
          setPolicy(recordToBoardPolicy(data.effective));
        }
      } catch {
        // Keep code baseline — server still enforces persisted policy.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { policy, loading };
}
