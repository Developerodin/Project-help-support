'use client';

import { useId, useRef, useState } from 'react';
import Icon from '../icons.jsx';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_HINT, formatFileSize, validateAttachmentBatch,
} from '@/shared/lib/attachment-config.js';

/**
 * Files the user has added in the chat or voice dock, waiting to be attached to
 * a ticket. Nothing is uploaded here: the assistant has to confirm the ticket
 * and project first, and the upload happens when the user confirms that card.
 * Same type, size and count rules as the ticket drawer.
 */
export function stageFiles(current, incoming) {
  const { errors, valid } = validateAttachmentBatch(current, [...incoming]);
  return { files: [...current, ...valid], error: errors.length ? errors.join('; ') : null };
}

/** A paperclip button that opens the file picker. */
export function AttachButton({ onAdd, disabled, className = 'assistant-icon-btn' }) {
  const inputRef = useRef(null);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="Attach files"
        title={`Attach files. ${ATTACHMENT_HINT}`}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="clip" size={18} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={ATTACHMENT_ACCEPT}
        data-testid="assistant-file-input"
        onChange={(event) => {
          onAdd(event.target.files || []);
          event.target.value = ''; // picking the same file again still fires
        }}
      />
    </>
  );
}

/** The waiting files as removable chips, plus why any were refused. */
export function StagedFiles({ files, error, onRemove }) {
  if (!files.length && !error) return null;
  return (
    <div className="assistant-staged">
      {files.length ? (
        <ul aria-label="Files ready to attach">
          {files.map((file) => (
            <li key={`${file.name}:${file.size}`} className="assistant-staged-chip">
              <Icon name="clip" size={12} aria-hidden="true" />
              <span className="assistant-staged-name" title={file.name}>{file.name}</span>
              <span className="assistant-staged-size">{formatFileSize(file.size)}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file)}>
                <Icon name="x" size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="assistant-staged-error" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * The same drop area as the ticket's Attachments tab (its .file-drop styles):
 * drag files in, or click / Enter / Space to browse.
 */
export function FileDropZone({ onAdd, disabled, hasFiles }) {
  const inputRef = useRef(null);
  const hintId = useId();
  const [over, setOver] = useState(false);
  const browse = () => { if (!disabled) inputRef.current?.click(); };
  return (
    <div
      className={['file-drop', 'attach-dropzone', 'assistant-dropzone', over ? 'over' : '', disabled ? 'disabled' : '']
        .filter(Boolean).join(' ')}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-labelledby={hintId}
      aria-disabled={disabled || undefined}
      onClick={browse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          browse();
        }
      }}
      onDragEnter={(event) => { if (!disabled) { event.preventDefault(); setOver(true); } }}
      onDragOver={(event) => { if (!disabled) event.preventDefault(); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false); }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        // Handled here, not by the panel or dock around it, so files aren't added twice.
        event.stopPropagation();
        setOver(false);
        if (event.dataTransfer?.files?.length) onAdd(event.dataTransfer.files);
      }}
    >
      <Icon name="clip" size={18} aria-hidden="true" />
      <p className="file-drop-title" id={hintId}>
        {hasFiles ? 'Add more: drag here or ' : 'Drag files here or '}
        <span className="browse">browse</span>
      </p>
      <p className="file-drop-hint">{ATTACHMENT_HINT}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        accept={ATTACHMENT_ACCEPT}
        aria-label="Choose files to attach"
        tabIndex={-1}
        disabled={disabled}
        data-testid="assistant-drop-input"
        onChange={(event) => {
          onAdd(event.target.files || []);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** Drop handlers for a surface that accepts files (the panel, the voice dock). */
export function fileDropProps(onAdd) {
  return {
    onDragOver: (event) => {
      if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
    },
    onDrop: (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      onAdd(event.dataTransfer.files);
    },
  };
}
