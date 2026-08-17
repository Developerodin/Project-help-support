'use client';

import { useEffect, useMemo, useState } from 'react';
import { listUsers } from '@/shared/api/users.js';
import {
  getProjectClientTesters,
  replaceProjectClientTesters,
} from '@/shared/api/projects.js';
import { ROLE_IDS } from '@pms/shared';
import { showToast } from '@/shared/lib/toast.js';

export default function ProjectClientTestersPanel({ project }) {
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
    () => new Set(
      effectiveItems
        .filter((item) => item.scopeType === 'company')
        .map((item) => item.userId),
    ),
    [effectiveItems],
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

  function toggleUser(userId) {
    if (companyWideIds.has(userId)) return;
    setSelectedIds((prev) => (
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    ));
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
      <div className="project-team-panel__head">
        <span className="lbl">Client testers</span>
        <span className="meta">{effectiveItems.length} effective</span>
      </div>
      <p className="project-form-hint">
        External Client Tester users scoped to this project. Company-wide assignments
        apply automatically and cannot be removed here.
      </p>

      {loading ? (
        <p className="project-team-panel__empty">Loading client testers…</p>
      ) : eligibleUsers.length === 0 ? (
        <p className="project-team-panel__empty">
          No active Client Tester users yet. Invite them from People with the Client Tester role.
        </p>
      ) : (
        <ul className="project-team-panel__list">
          {eligibleUsers.map((user) => {
            const companyWide = companyWideIds.has(user.id);
            const checked = companyWide || selectedIds.includes(user.id);
            return (
              <li key={user.id} className="project-team-panel__row">
                <label className="project-client-testers-panel__choice">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={companyWide}
                    onChange={() => toggleUser(user.id)}
                  />
                  <span className="project-team-panel__who">
                    <b>{user.name || user.email}</b>
                    <span>{user.email}</span>
                  </span>
                </label>
                {companyWide ? <span className="chip">Company-wide</span> : null}
              </li>
            );
          })}
        </ul>
      )}

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
