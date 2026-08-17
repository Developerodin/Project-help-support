'use client';

import { useEffect, useState } from 'react';

const DOT_COUNT = 12;
const LOADING_LABEL = 'Loading\u2026';

const DEFAULT_PHRASES = [
  LOADING_LABEL,
  'Preparing workspace\u2026',
  'Checking session\u2026',
  'Just a moment\u2026',
];

const PHRASE_MS = 4000;

export default function AppLoader({
  inline = false,
  label = LOADING_LABEL,
  ariaLabel = 'Loading',
}) {
  const cyclesPhrases = label === LOADING_LABEL;
  const [phraseIndex, setPhraseIndex] = useState(0);
  const activeLabel = cyclesPhrases ? DEFAULT_PHRASES[phraseIndex] : label;

  useEffect(() => {
    if (!cyclesPhrases) return undefined;
    const timer = window.setInterval(() => {
      setPhraseIndex((index) => (index + 1) % DEFAULT_PHRASES.length);
    }, PHRASE_MS);
    return () => window.clearInterval(timer);
  }, [cyclesPhrases]);

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
        {activeLabel ? (
          <p
            key={activeLabel}
            className="app-loader__label"
            style={{
              '--loader-label-width': `${activeLabel.length}ch`,
              '--loader-label-steps': activeLabel.length,
            }}
          >
            {activeLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}