'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  ENVIRONMENTS,
  EXTERNAL_ROLES,
  ROLE_LABELS,
  SCOPED_ASSIGNABLE_ROLES,
} from '@pms/shared';
import FormError from '@/shared/components/form-error.jsx';
import { capRole } from '@/shared/lib/profile-utils.js';

const SCOPE_GLOBAL = 'global';
const SCOPE_CLIENT = 'client';
const SCOPE_PROJECT = 'project';

export default function GrantAccessDialog({
  open,
  user,
  clients = [],
  projects = [],
  error = null,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const formId = useId();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState(SCOPED_ASSIGNABLE_ROLES[0]);
  const [scopeLevel, setScopeLevel] = useState(SCOPE_PROJECT);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [environments, setEnvironments] = useState(['Staging']);
  const [reason, setReason] = useState('');

  const internalRoles = SCOPED_ASSIGNABLE_ROLES.filter((item) => !EXTERNAL_ROLES.includes(item));
  const externalRoles = SCOPED_ASSIGNABLE_ROLES.filter((item) => EXTERNAL_ROLES.includes(item));
  const filteredProjects = clientId
    ? projects.filter((item) => String(item.client) === String(clientId) || String(item.clientId) === String(clientId))
    : projects;
  const needsReason = environments.includes('Production');

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    setStep(0);
    setRole(SCOPED_ASSIGNABLE_ROLES[0]);
    setScopeLevel(SCOPE_PROJECT);
    setClientId('');
    setProjectId('');
    setEnvironments(['Staging']);
    setReason('');
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, busy]);

  function toggleEnvironment(env) {
    setEnvironments((current) => {
      const next = new Set(current);
      if (next.has(env)) next.delete(env);
      else next.add(env);
      return [...next];
    });
  }

  function buildPayload() {
    const body = {
      role,
      environments,
      reason: reason.trim() || undefined,
    };
    if (scopeLevel === SCOPE_CLIENT) {
      body.clientId = clientId;
      body.projectId = null;
    } else if (scopeLevel === SCOPE_PROJECT) {
      body.clientId = clientId;
      body.projectId = projectId;
    } else {
      body.clientId = null;
      body.projectId = null;
    }
    return body;
  }

  function canAdvance() {
    if (step === 0) {
      if (!role) return false;
      if (scopeLevel === SCOPE_CLIENT && !clientId) return false;
      if (scopeLevel === SCOPE_PROJECT && (!clientId || !projectId)) return false;
      return true;
    }
    if (needsReason && !reason.trim()) return false;
    return true;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!busy && canAdvance()) onConfirm(buildPayload());
  }

  if (!open) return null;

  const person = user?.name || user?.email || 'this person';

  return (
    <div className="dscrim on" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={busy || undefined}
        className="dlg grant-access-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3 id={titleId}>Grant access</h3>
          <p id={descId}>
            Step {step + 1} of 2 — scoped role for {person}.
          </p>
        </div>

        <form id={formId} className="dlg-body" onSubmit={handleSubmit}>
          <FormError error={error} />

          {step === 0 && (
            <>
              <div className="form-row">
                <label>Role</label>
                <div className="grant-access-role-groups">
                  {internalRoles.length > 0 && (
                    <div className="grant-access-role-group">
                      <p className="grant-access-role-caption">Team</p>
                      <div className="grant-access-role-grid">
                        {internalRoles.map((item) => (
                          <label key={item} className={`grant-access-role${role === item ? ' is-on' : ''}`}>
                            <input
                              type="radio"
                              name="grant-role"
                              checked={role === item}
                              disabled={busy}
                              onChange={() => setRole(item)}
                            />
                            <span>{ROLE_LABELS[item] || capRole(item)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {externalRoles.length > 0 && (
                    <div className="grant-access-role-group">
                      <p className="grant-access-role-caption">Client side</p>
                      <div className="grant-access-role-grid">
                        {externalRoles.map((item) => (
                          <label key={item} className={`grant-access-role${role === item ? ' is-on' : ''}`}>
                            <input
                              type="radio"
                              name="grant-role"
                              checked={role === item}
                              disabled={busy}
                              onChange={() => setRole(item)}
                            />
                            <span>{ROLE_LABELS[item] || capRole(item)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-row">
                <label>Scope</label>
                <div className="grant-access-scope">
                  <label className={`grant-access-scope__option${scopeLevel === SCOPE_GLOBAL ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name="grant-scope"
                      checked={scopeLevel === SCOPE_GLOBAL}
                      disabled={busy}
                      onChange={() => setScopeLevel(SCOPE_GLOBAL)}
                    />
                    <span>Global (all clients)</span>
                  </label>
                  <label className={`grant-access-scope__option${scopeLevel === SCOPE_CLIENT ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name="grant-scope"
                      checked={scopeLevel === SCOPE_CLIENT}
                      disabled={busy}
                      onChange={() => setScopeLevel(SCOPE_CLIENT)}
                    />
                    <span>Client</span>
                  </label>
                  <label className={`grant-access-scope__option${scopeLevel === SCOPE_PROJECT ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name="grant-scope"
                      checked={scopeLevel === SCOPE_PROJECT}
                      disabled={busy}
                      onChange={() => setScopeLevel(SCOPE_PROJECT)}
                    />
                    <span>Project</span>
                  </label>
                </div>
              </div>

              {scopeLevel !== SCOPE_GLOBAL && (
                <div className="form-row">
                  <label htmlFor="grant-client">Client</label>
                  <select
                    id="grant-client"
                    value={clientId}
                    disabled={busy}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setProjectId('');
                    }}
                  >
                    <option value="">Select client…</option>
                    {clients.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {scopeLevel === SCOPE_PROJECT && (
                <div className="form-row">
                  <label htmlFor="grant-project">Project</label>
                  <select
                    id="grant-project"
                    value={projectId}
                    disabled={busy || !clientId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    <option value="">Select project…</option>
                    {filteredProjects.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <div className="form-row">
                <span className="form-label">Environments</span>
                <div className="grant-access-envs">
                  {ENVIRONMENTS.map((env) => (
                    <label key={env} className={`grant-access-env${environments.includes(env) ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={environments.includes(env)}
                        disabled={busy}
                        onChange={() => toggleEnvironment(env)}
                      />
                      <span>{env}</span>
                    </label>
                  ))}
                </div>
                <p className="rbac-preview-disabled-note">Empty selection means no ticket environment access.</p>
              </div>

              <div className="form-row">
                <label htmlFor="grant-reason">
                  Reason{needsReason ? '' : ' (optional)'}
                </label>
                <textarea
                  id="grant-reason"
                  rows={3}
                  value={reason}
                  disabled={busy}
                  placeholder={needsReason ? 'Required for Production access' : 'Optional note for the audit trail'}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            </>
          )}
        </form>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <span className="spacer" />
          {step > 0 && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setStep(0)}
            >
              Back
            </button>
          )}
          {step === 0 ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !canAdvance()}
              onClick={() => setStep(1)}
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              form={formId}
              className="btn btn-primary"
              disabled={busy || !canAdvance()}
              aria-busy={busy || undefined}
            >
              {busy ? (
                <>
                  <span className="btn-spin" aria-hidden="true" />
                  Granting…
                </>
              ) : 'Grant access'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
