import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineContentDisposition } from '../s3.js';

test('inline Content-Disposition keeps ASCII names and uses the RFC 5987 form', () => {
  assert.equal(
    inlineContentDisposition('Q3-spec.pdf'),
    'inline; filename="Q3-spec.pdf"; filename*=UTF-8\'\'Q3-spec.pdf',
  );
});

test('inline Content-Disposition encodes unicode in filename* and falls back to ASCII', () => {
  const header = inlineContentDisposition('Q3-仕様.pdf');
  assert.match(header, /^inline; filename="Q3-__\.pdf"; filename\*=UTF-8''/);
  assert.ok(header.includes("filename*=UTF-8''Q3-%E4%BB%95%E6%A7%98.pdf"));
  assert.ok(!header.startsWith('attachment'));
});

test('inline Content-Disposition strips CR/LF, quotes, slashes, and parent-dir segments', () => {
  assert.equal(
    inlineContentDisposition('Q3\r\n"spec.pdf'),
    'inline; filename="Q3spec.pdf"; filename*=UTF-8\'\'Q3spec.pdf',
  );
  assert.equal(
    inlineContentDisposition('../Q3/spec\\file.pdf'),
    'inline; filename="Q3specfile.pdf"; filename*=UTF-8\'\'Q3specfile.pdf',
  );
});
