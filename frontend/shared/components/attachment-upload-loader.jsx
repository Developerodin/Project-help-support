'use client';

const DOT_COUNT = 12;

export default function AttachmentUploadLoader({
  variant = 'compact',
  label = 'Uploading…',
  ariaLabel = 'Uploading attachment',
}) {
  return (
    <div
      className={`attach-upload-loader attach-upload-loader--${variant}`}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <div className="attach-upload-loader__scene" aria-hidden="true">
        <div className="attach-upload-loader__orbit">
          {Array.from({ length: DOT_COUNT }, (_, i) => (
            <span
              key={i}
              className="attach-upload-loader__dot"
              style={{ '--i': i }}
            />
          ))}
        </div>
      </div>
      <p className="attach-upload-loader__label">{label}</p>
    </div>
  );
}
