'use client';

import { useEffect, useRef, useState } from 'react';
import FormError from '@/shared/components/form-error.jsx';
import CompanyLogo from '@/shared/components/companies/company-logo.jsx';
import { createClient, uploadClientLogo } from '@/shared/api/clients.js';

export default function NewCompanyDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

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
    if (!open) {
      setName('');
      setLogoFile(null);
      setLogoPreview(null);
      setError(null);
      setBusy(false);
    }
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

  async function onSubmit(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError({ message: 'Company name is required.' });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await createClient({ name: trimmed, status: 'active' });
      let result = created;
      if (logoFile) {
        result = await uploadClientLogo(created.id, logoFile);
      }
      onCreated?.(result);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const previewCompany = logoPreview
    ? { name: name.trim() || 'Company', logoUrl: logoPreview }
    : { name: name.trim() || 'Company' };

  return (
    <div className="dscrim on" role="presentation" onClick={() => !busy && onClose()}>
      <form
        className="dlg"
        onSubmit={onSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3>New company</h3>
          <p>Create a company to group related projects.</p>
        </div>

        <div className="dlg-body company-dialog-body">
          <FormError error={error} />

          <div className="company-dialog-logo-row">
            <CompanyLogo company={previewCompany} size={56} />
            <div className="form-row">
              <label htmlFor="new-company-logo">Logo</label>
              <input
                id="new-company-logo"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={onLogoChange}
                disabled={busy}
              />
              <span className="help">Optional. PNG, JPEG, GIF, or WebP up to 2 MB.</span>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="new-company-name">
              Company name <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id="new-company-name"
              ref={nameRef}
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              placeholder="e.g. Dharwin"
            />
          </div>
        </div>

        <div className="dlg-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create company'}
          </button>
        </div>
      </form>
    </div>
  );
}
