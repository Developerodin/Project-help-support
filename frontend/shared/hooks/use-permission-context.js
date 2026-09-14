'use client';

import { useEffect, useState } from 'react';
import { getRoleMatrixEffective } from '../api/rbac.js';

/**
 * Load the effective role matrix once per session. Falls back to code baseline
 * when the API is unreachable (server still enforces persisted policy).
 */
export function usePermissionContext() {
  const [permissionContext, setPermissionContext] = useState({
    roleMatrix: null,
    userOverrides: {},
    scopedAssignments: [],
    loadFailed: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getRoleMatrixEffective();
        if (!cancelled && data?.effective) {
          setPermissionContext({
            roleMatrix: data.effective,
            userOverrides: data.userOverrides ?? {},
            scopedAssignments: data.scopedAssignments ?? [],
            loadFailed: false,
          });
        }
      } catch {
        if (!cancelled) {
          setPermissionContext({
            roleMatrix: null,
            userOverrides: {},
            scopedAssignments: [],
            loadFailed: true,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { permissionContext, loading };
}
