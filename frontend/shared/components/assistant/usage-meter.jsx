'use client';

import { useEffect, useId, useState } from 'react';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** "3 hr 37 min", "37 min", or "under a minute" until `resetsAt`. */
export function formatResetIn(resetsAt, now = Date.now()) {
  const minutes = Math.max(0, Math.round((new Date(resetsAt).getTime() - now) / 60_000));
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** The one-line summary shown in the tooltip and read to screen readers. */
export function usageSummary(usage, now = Date.now()) {
  const resets = `Resets in ${formatResetIn(usage.resetsAt, now)}`;
  return usage.percent >= 100
    ? `Daily ₹${usage.limitInr} limit reached · ${resets}`
    : `${usage.percent}% of ₹${usage.limitInr} daily limit · ${resets}`;
}

/**
 * Today's assistant allowance as a small ring, like a usage gauge: hover or
 * focus it for the details. Amber from 80%, red at the limit. When the reset
 * time passes it asks for fresh numbers (`onReset`).
 */
export default function UsageMeter({ usage, onReset }) {
  const tooltipId = useId();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const resetDue = Boolean(usage) && now >= new Date(usage.resetsAt).getTime();
  useEffect(() => {
    if (resetDue) onReset?.();
  }, [resetDue, onReset]);

  if (!usage) return null;
  const percent = Math.min(100, Math.max(0, usage.percent));
  const level = percent >= 100 ? ' is-full' : percent >= 80 ? ' is-high' : '';
  const summary = usageSummary(usage, now);

  return (
    <span
      className={`usage-meter${level}`}
      role="meter"
      tabIndex={0}
      aria-label="Assistant usage today"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={summary}
      aria-describedby={tooltipId}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="usage-meter-track" cx="9" cy="9" r={RADIUS} />
        <circle
          className="usage-meter-fill"
          cx="9"
          cy="9"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
      <span className="usage-meter-tip" role="tooltip" id={tooltipId}>
        <strong>Usage</strong>
        <span>{summary}</span>
      </span>
    </span>
  );
}
