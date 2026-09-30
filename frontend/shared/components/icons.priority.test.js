import { describe, it, expect } from 'vitest';
import {
  normalizePriority,
  priorityChipClass,
  priorityCardClass,
  priorityDataValue,
  priorityLabel,
} from './icons.jsx';

describe('priority helpers', () => {
  it('normalizes priority keys case-insensitively', () => {
    expect(normalizePriority('high')).toBe('High');
    expect(normalizePriority(' URGENT ')).toBe('Urgent');
    expect(normalizePriority('unknown')).toBeNull();
  });

  it('maps each tier to distinct chip classes', () => {
    expect(priorityChipClass('Urgent')).toBe('chip chip-p1');
    expect(priorityChipClass('High')).toBe('chip chip-p2');
    expect(priorityChipClass('Medium')).toBe('chip chip-p3');
    expect(priorityChipClass('Low')).toBe('chip chip-p4');
    expect(priorityChipClass('bogus')).toBe('chip chip-p3');
  });

  it('maps card surface classes from priority', () => {
    expect(priorityCardClass('High')).toBe('card-priority-high');
    expect(priorityCardClass('low')).toBe('card-priority-low');
    expect(priorityCardClass(null)).toBe('');
  });

  it('exposes labels and data attributes for a11y', () => {
    expect(priorityLabel('medium')).toBe('Medium');
    expect(priorityLabel('')).toBe('—');
    expect(priorityDataValue('High')).toBe('high');
    expect(priorityDataValue(null)).toBe('unknown');
  });
});
