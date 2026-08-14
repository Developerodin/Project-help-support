import { describe, it, expect } from 'vitest';
import {
  formatFileSize,
  isAllowedAttachment,
  validateAttachmentBatch,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_BYTES,
} from '../attachment-config.js';

describe('attachment-config', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1536)).toBe('1.50 KB');
  });

  it('allows common image and document types', () => {
    expect(isAllowedAttachment({ name: 'shot.png', type: 'image/png', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'notes.txt', type: 'text/plain', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'data.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'photo.bmp', type: 'image/bmp', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'readme.md', type: 'text/markdown', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'config.yaml', type: 'text/yaml', size: 1 })).toBe(true);
    expect(isAllowedAttachment({ name: 'archive.7z', type: 'application/x-7z-compressed', size: 1 })).toBe(true);
  });

  it('rejects blocked extensions', () => {
    expect(isAllowedAttachment({ name: 'payload.svg', type: 'image/svg+xml', size: 1 })).toBe(false);
    expect(isAllowedAttachment({ name: 'run.exe', type: 'application/octet-stream', size: 1 })).toBe(false);
  });

  it('enforces max file count', () => {
    const existing = Array.from({ length: MAX_ATTACHMENT_FILES }, (_, i) => (
      { name: `f${i}.png`, type: 'image/png', size: 1 }
    ));
    const { errors, valid } = validateAttachmentBatch(existing, [
      { name: 'extra.png', type: 'image/png', size: 1 },
    ]);
    expect(errors).toEqual(['Maximum 10 files allowed.']);
    expect(valid).toEqual([]);
  });

  it('rejects oversize files', () => {
    const { errors, valid } = validateAttachmentBatch([], [
      { name: 'big.png', type: 'image/png', size: MAX_ATTACHMENT_BYTES + 1 },
    ]);
    expect(errors[0]).toMatch(/25 MB/);
    expect(valid).toEqual([]);
  });
});
