import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffType, safeKey, MAX_FILE_BYTES } from '../upload.js';

const bytes = (...values) => Buffer.from(values);
const png = () => Buffer.concat([
  bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A), Buffer.alloc(32),
]);
const jpeg = () => Buffer.concat([bytes(0xFF, 0xD8, 0xFF, 0xE0), Buffer.alloc(32)]);
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(32)]);
const elf = () => Buffer.concat([bytes(0x7F, 0x45, 0x4C, 0x46), Buffer.alloc(32)]);

test('a real png with a .png name is accepted', () => {
  assert.deepEqual(sniffType(png(), 'screenshot.png'), { mime: 'image/png', ext: 'png' });
});

test('content decides, not the declared name — a png named .jpg is rejected', () => {
  assert.throws(
    () => sniffType(png(), 'screenshot.jpg'),
    (err) => err.statusCode === 400 && err.code === 'MIME_EXTENSION_MISMATCH',
  );
});

test('an executable renamed to .png is rejected', () => {
  assert.throws(
    () => sniffType(elf(), 'totally-an-image.png'),
    (err) => err.statusCode === 400 && err.code === 'UNSUPPORTED_FILE_TYPE',
  );
});

test('scriptable and executable extensions are rejected before any sniffing', () => {
  for (const name of ['payload.svg', 'setup.exe', 'run.sh', 'go.bat', 'p.ps1', 'x.jar', 'a.dll']) {
    assert.throws(
      () => sniffType(png(), name),
      (err) => err.statusCode === 400 && err.code === 'BLOCKED_FILE_TYPE',
      `${name} must be blocked`,
    );
  }
});

test('a text log is accepted on content, and a binary one is not', () => {
  assert.deepEqual(sniffType(Buffer.from('2026-08-13 ERROR boom\n'), 'app.log'), {
    mime: 'text/plain', ext: 'log',
  });

  assert.throws(
    () => sniffType(bytes(0x00, 0x01, 0x02, 0x00), 'app.log'),
    (err) => err.code === 'UNSUPPORTED_FILE_TYPE',
  );
});

test('pdf and jpeg round-trip', () => {
  assert.equal(sniffType(pdf(), 'report.pdf').mime, 'application/pdf');
  assert.equal(sniffType(jpeg(), 'photo.jpeg').ext, 'jpeg');
});

test('a file with no extension is rejected rather than guessed', () => {
  assert.throws(
    () => sniffType(png(), 'screenshot'),
    (err) => err.code === 'UNSUPPORTED_FILE_TYPE',
  );
});

test('the stored key never contains anything from the filename', () => {
  const key = safeKey('507f1f77bcf86cd799439011', 'png');

  assert.match(key, /^tickets\/507f1f77bcf86cd799439011\/\d+-[a-f0-9]{16}\.png$/);
  assert.ok(!key.includes('..'));
});

test('a traversal filename cannot influence the key', () => {
  // The filename is not an input to safeKey at all — that is the defence.
  const key = safeKey('507f1f77bcf86cd799439011', 'png');
  assert.ok(!key.includes('/etc/'));
});

test('the comment prefix is honoured', () => {
  const key = safeKey('507f1f77bcf86cd799439011', 'png', { prefix: 'tickets/comments' });
  assert.ok(key.startsWith('tickets/comments/507f1f77bcf86cd799439011/'));
});

test('the per-file size limit is a real number the S3 policy can mirror', () => {
  assert.equal(typeof MAX_FILE_BYTES, 'number');
  assert.ok(MAX_FILE_BYTES > 0);
});
