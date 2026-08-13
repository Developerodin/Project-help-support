'use client';

import { LANES } from '@pms/shared';

export default function StatsStrip({ counts, onSelectLane }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {LANES.map((lane) => (
        <button
          key={lane.key}
          type="button"
          onClick={() => onSelectLane?.(lane)}
          style={{ flex: 1, padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}
        >
          <div style={{ color: 'var(--muted)' }}>{lane.label}</div>
          <strong style={{ fontSize: 20 }}>{counts?.[lane.key] ?? 0}</strong>
        </button>
      ))}
    </div>
  );
}
