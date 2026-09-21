'use client';

import { useEffect, useState } from 'react';
import { getProject } from '@/shared/api/projects.js';

export function useProjectMentionCandidates(projectId, { enabled = true } = {}) {
  const [candidates, setCandidates] = useState([]);

  useEffect(() => {
    if (!enabled || !projectId) {
      setCandidates([]);
      return undefined;
    }
    let cancelled = false;
    getProject(projectId)
      .then((project) => {
        if (cancelled) return;
        const members = (project.teamMembers || [])
          .map((member) => {
            const user = member.user;
            const id = user?.id ?? user?._id;
            if (!id) return null;
            return {
              id: String(id),
              name: user?.name || user?.email || 'Unknown',
              email: user?.email || '',
            };
          })
          .filter(Boolean);
        setCandidates(members);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => { cancelled = true; };
  }, [projectId, enabled]);

  return candidates;
}
