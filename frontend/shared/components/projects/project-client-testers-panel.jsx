'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { listUsers } from '@/shared/api/users.js';
import {
  getProjectClientTesters,
  replaceProjectClientTesters,
} from '@/shared/api/projects.js';
import { ROLE_IDS } from '@pms/shared';
import { showToast } from '@/shared/lib/toast.js';
import ExternalUserMultiSelect from '@/shared/components/external-user-multi-select.jsx';

export default function ProjectClientTestersPanel({ project }) {
  const headingId = useId();
  const clientId = project.client?.id ?? project.client;
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [effectiveItems, setEffectiveItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setEligibleUsers([]);
      setEffectiveItems([]);
      setSelectedIds([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      listUsers({ role: ROLE_IDS.CLIENT_TESTER, status: 'active', limit: 100 }),
      getProjectClientTesters(project.id),
    ])
      .then(([usersPage, effective]) => {
        if (cancelled) return;
        setEligibleUsers(usersPage.results || []);
        setEffectiveItems(effective.items || []);
        const projectScopedIds = (effective.items || [])
          .filter((item) => item.scopeType === 'project')
          .map((item) => item.userId);
        setSelectedIds(projectScopedIds);
      })
      .catch(() => {
        if (!cancelled) {
          setEligibleUsers([]);
          setEffectiveItems([]);
          setSelectedIds([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [clientId, project.id]);

  const companyWideIds = useMemo(
    () => (effectiveItems || [])
      .filter((item) => item.scopeType === 'company')
      .map((item) => item.userId),
    [effectiveItems],
  );

  const displaySelectedIds = useMemo(
    () => [...new Set([...selectedIds, ...companyWideIds])],
    [selectedIds, companyWideIds],
  );

  const dirty = useMemo(() => {
    const current = new Set(
      effectiveItems
        .filter((item) => item.scopeType === 'project')
        .map((item) => item.userId),
    );
    const next = new Set(selectedIds);
    if (current.size !== next.size) return true;
    for (const id of current) {
      if (!next.has(id)) return true;
    }
    return false;
  }, [effectiveItems, selectedIds]);

  function onSelectionChange(nextIds) {
    const companyWideSet = new Set(companyWideIds);
    setSelectedIds(nextIds.filter((id) => !companyWideSet.has(id)));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await replaceProjectClientTesters(project.id, selectedIds);
      setEffectiveItems(result.items || []);
      const projectScopedIds = (result.items || [])
        .filter((item) => item.scopeType === 'project')
        .map((item) => item.userId);
      setSelectedIds(projectScopedIds);
      showToast('Client testers saved');
    } catch (err) {
      showToast(err?.message || 'Could not save client testers');
    } finally {
      setSaving(false);
    }
  }

  if (!clientId) {
    return (
      <p className="project-team-panel__empty">
        Assign a company to this project before selecting client testers.
      </p>
    );
  }

  return (
    <div className="project-team-panel project-client-testers-panel">
      <h5 className="project-form-heading" id={headingId}>Client tester assign</h5>

      <ExternalUserMultiSelect
        label="Client tester assign"
        hideLabel
        ariaLabelledBy={headingId}
        users={eligibleUsers}
        selectedIds={displaySelectedIds}
        onChange={onSelectionChange}
        disabled={saving}
        loading={loading}
        lockedIds={companyWideIds}
        emptyMessage="No client testers available. Invite users from People."
      />

      <div className="project-team-panel__foot">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!dirty || saving || loading}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save client testers'}
        </button>
      </div>
    </div>
  );
}
