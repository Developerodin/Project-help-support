'use client';

import { LANES } from '@pms/shared';

export default function StatsStrip({ counts, onSelectLane }) {
  return (
    <div className="stat-grid">
      {LANES.map((lane) => (
        <button
          key={lane.key}
          type="button"
          className="stat-tile"
          onClick={() => onSelectLane?.(lane)}
        >
          <div className="stat-label">{lane.label}</div>
          <div className="bigfig num">{counts?.[lane.key] ?? 0}</div>
        </button>
      ))}
    </div>
  );
}
