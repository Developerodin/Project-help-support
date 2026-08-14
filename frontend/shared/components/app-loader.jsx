'use client';

const DOT_COUNT = 12;
const LOADING_LABEL = 'Loading\u2026';

export default function AppLoader({
  inline = false,
  label = LOADING_LABEL,
  ariaLabel = 'Loading',
}) {
  return (
    <div
      className={`app-loader${inline ? ' app-loader--inline' : ' app-loader-screen app-loader--fullscreen'}`}
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <div className="app-loader__inner">
        <div className="app-loader__scene" aria-hidden="true">
          <div className="pl">
            {Array.from({ length: DOT_COUNT }, (_, i) => (
              <span key={i} className="pl__dot" style={{ '--i': i }} />
            ))}
          </div>
        </div>
        {label ? <p className="app-loader__label">{label}</p> : null}
      </div>
    </div>
  );
}