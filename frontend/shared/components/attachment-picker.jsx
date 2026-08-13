'use client';

import { useId, useRef, useState } from 'react';
import Icon from '@/shared/components/icons.jsx';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_HINT,
  formatFileSize,
} from '@/shared/lib/attachment-config.js';

export default function AttachmentPicker({
  files,
  onChange,
  onAddFiles,
  errors = [],
  disabled = false,
  idPrefix = 'attach',
}) {
  const inputRef = useRef(null);
  const hintId = useId();
  const errorId = useId();
  const [dragOver, setDragOver] = useState(false);

  function pick() {
    if (!disabled) inputRef.current?.click();
  }

  function removeAt(index) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="form-row">
      <span className="lbl" id={`${idPrefix}-label`}>Attachments</span>
      <p className="help" id={hintId}>Optional. Screenshots, logs, or recordings help triage faster.</p>

      <div
        className={`file-drop${dragOver ? ' over' : ''}${disabled ? ' disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${idPrefix}-label`}
        aria-describedby={errors.length ? `${hintId} ${errorId}` : hintId}
        aria-disabled={disabled}
        onClick={pick}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            pick();
          }
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragOver(false);
          onAddFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <Icon name="clip" size={18} />
        <p className="file-drop-title">
          Drag files here or <span className="browse">browse</span>
        </p>
        <p className="file-drop-hint">{ATTACHMENT_HINT}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept={ATTACHMENT_ACCEPT}
          disabled={disabled}
          aria-hidden="true"
          aria-label="Add attachments"
          tabIndex={-1}
          onChange={(event) => {
            onAddFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      {errors.length > 0 ? (
        <p id={errorId} className="field-hint invalid" role="alert">
          {errors.join(' ')}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="file-list" aria-label="Selected attachments">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`}>
              <Icon name="clip" size={14} />
              <span className="nm" title={file.name}>{file.name}</span>
              <span className="sz">{formatFileSize(file.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  removeAt(index);
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
