'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon from './icons.jsx';
import { MAX_ATTACHMENT_BYTES, formatFileSize } from '@/shared/lib/attachment-config.js';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif';

export default function RemarkDialog({
  open,
  title,
  label,
  hint,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  value = '',
  onChange,
  onConfirm,
  onCancel,
  // Optional single image. Passing onImageChange is what turns the picker on.
  image = null,
  onImageChange,
  imageLabel = 'Attach a screenshot (optional)',
}) {
  const fieldRef = useRef(null);
  const dialogRef = useRef(null);
  const imageInputRef = useRef(null);
  const [imageError, setImageError] = useState(null);
  const fieldId = useId();
  const titleId = useId();
  const hintId = useId();
  const trimmed = value.trim();

  function pickImage(file) {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      setImageError('Pick an image file.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setImageError(`${file.name} is over the ${formatFileSize(MAX_ATTACHMENT_BYTES)} limit.`);
      return;
    }
    setImageError(null);
    onImageChange(file);
  }

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    setImageError(null);
    // Focus the first FIELD, and do it in the same commit as the mount. A
    // deferred focus() yanks the caret away from anyone who started typing
    // inside the delay, and their keystrokes land on a button instead.
    fieldRef.current?.focus();
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

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open, busy]);

  if (!open) return null;

  return (
    <div
      className="dscrim on"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={fieldId}
        aria-busy={busy || undefined}
        className="dlg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dlg-head">
          <h3 id={titleId}>{title}</h3>
        </div>
        <div className="dlg-body">
          <div className="form-row">
            <label htmlFor={fieldId}>{label}</label>
            <textarea
              ref={fieldRef}
              id={fieldId}
              className="input"
              rows={4}
              value={value}
              onChange={onChange}
              disabled={busy}
              aria-describedby={hint ? hintId : undefined}
            />
            {hint && <p id={hintId} className="field-hint">{hint}</p>}
          </div>

          {onImageChange && (
            <div className="form-row">
              <span className="remark-image-label">{imageLabel}</span>
              {image ? (
                <div className="remark-image">
                  <Icon name="clip" size={13} aria-hidden="true" />
                  <span className="nm" title={image.name}>{image.name}</span>
                  <span className="sz">{formatFileSize(image.size)}</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => { setImageError(null); onImageChange(null); }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm remark-image-pick"
                  disabled={busy}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Icon name="clip" size={13} aria-hidden="true" />
                  {' '}
                  Choose image
                </button>
              )}
              {imageError && <p className="field-hint invalid" role="alert">{imageError}</p>}
              <input
                ref={imageInputRef}
                type="file"
                className="sr-only"
                accept={IMAGE_ACCEPT}
                aria-label={imageLabel}
                tabIndex={-1}
                onChange={(event) => {
                  pickImage(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </div>
          )}
        </div>
        <div className="dlg-foot">
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy || !trimmed}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <span className="btn-spin" aria-hidden="true" />
                Working…
              </>
            ) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
