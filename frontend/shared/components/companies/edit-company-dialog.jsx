'use client';

import { useEffect, useRef, useState } from 'react';
import FormError from '@/shared/components/form-error.jsx';
import CompanyLogo from '@/shared/components/companies/company-logo.jsx';
import CompanyExternalAccessFields from '@/shared/components/companies/company-external-access-fields.jsx';
import { getClient, patchClient, uploadClientLogo, removeClientLogo } from '@/shared/api/clients.js';

export default function EditCompanyDialog({ open, company, onClose, onUpdated }) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [clientUserIds, setClientUserIds] = useState([]);
  const [clientTesterIds, setClientTesterIds] = useState([]);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    if (!company) return;
    setName(company.name ?? '');
    setStatus(company.status ?? 'active');
    setLogoFile(null);
    setLogoPreview(null);
    setError(null);
    setClientUserIds(company.externalAccess?.clientUserIds ?? []);
    setClientTesterIds(company.externalAccess?.clientTesterIds ?? []);
  }, [company, open]);

  useEffect(() => {
    if (!open || !company?.id) return undefined;
    let cancelled = false;
    getClient(company.id)
      .then((fetched) => {
        if (cancelled) return;
        setClientUserIds(fetched.externalAccess?.clientUserIds ?? []);
        setClientTesterIds(fetched.externalAccess?.clientTesterIds ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, company?.id]);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  function onLogoChange(event) {
    const file = event.target.files?.[0];
    setLogoFile(file ?? null);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function onRemoveLogo() {
    if (!company?.id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await removeClientLogo(company.id);
      setLogoFile(null);
      setLogoPreview(null);
      onUpdated?.(updated);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!company?.id) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError({ message: 'Company name is required.' });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let updated = await patchClient(company.id, {
        name: trimmed,
        status,
        clientUserIds,
        clientTesterIds,
      });
      if (logoFile) {
        updated = await uploadClientLogo(company.id, logoFile);
      }
      onUpdated?.(updated);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!open || !company) return null;

  const previewCompany = logoPreview
    ? { ...company, name: name.trim() || company.name, logoUrl: logoPreview }
    : { ...company, name: name.trim() || company.name };

  return (
    <div className="dscrim on" role="presentation" onClick={() => !busy && onClose()}>
      <form
        className="dlg wide company-dialog"
        onSubmit={onSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3>Edit company</h3>
          <p>Update the company name, logo, or status.</p>
        </div>

        <div className="dlg-body company-dialog-body">
          <FormError error={error} />

          <section className="company-dialog-section" aria-labelledby="edit-company-details-heading">
            <h4 id="edit-company-details-heading" className="form-section">Company details</h4>

            <div className="company-dialog-logo-row">
              <CompanyLogo company={previewCompany} size={56} />
              <div className="form-row">
                <label htmlFor="edit-company-logo">Logo</label>
                <input
                  id="edit-company-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={onLogoChange}
                  disabled={busy}
                />
                {company.logoKey || company.logoUrl ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onRemoveLogo}
                    disabled={busy}
                  >
                    Remove logo
                  </button>
                ) : null}
                <span className="help">PNG, JPEG, GIF, or WebP up to 2 MB.</span>
              </div>
            </div>

            <div className="form-row">
              <label htmlFor="edit-company-name">
                Company name <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                id="edit-company-name"
                ref={nameRef}
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="form-row">
              <label htmlFor="edit-company-status">Status</label>
              <select
                id="edit-company-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={busy}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
              <span className="help">Archiving a company does not delete its projects.</span>
            </div>
          </section>

          <section className="company-dialog-section" aria-labelledby="edit-company-access-heading">
            <CompanyExternalAccessFields
              clientUserIds={clientUserIds}
              clientTesterIds={clientTesterIds}
              onClientUserIdsChange={setClientUserIds}
              onClientTesterIdsChange={setClientTesterIds}
              disabled={busy}
            />
          </section>
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
