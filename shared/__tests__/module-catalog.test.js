import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEB_MODULE_TAXONOMY,
  WEB_MODULE_LABELS,
  getPagesForModule,
  resolveProjectModules,
} from '../module-catalog.js';

test('WEB module catalog matches Dharwin Help & Support groups', () => {
  assert.ok(WEB_MODULE_TAXONOMY.length >= 9);
  assert.deepEqual(WEB_MODULE_LABELS.slice(0, 3), ['MAIN', 'ATS', 'ORGANIZATION']);
  assert.ok(Object.isFrozen(WEB_MODULE_TAXONOMY));
});

test('getPagesForModule returns pages for a known module', () => {
  const pages = getPagesForModule('ATS');
  assert.ok(pages.some((p) => p.label === 'Jobs' && p.path === '/ats/jobs'));
});

test('resolveProjectModules prefers stored project modules', () => {
  const custom = [{ label: 'Custom', pages: [{ label: 'Home', path: '/home' }] }];
  assert.deepEqual(resolveProjectModules({ key: 'WEB', modules: custom }), custom);
});

test('resolveProjectModules falls back to WEB catalog when modules empty', () => {
  assert.equal(resolveProjectModules({ key: 'WEB', modules: [] }).length, WEB_MODULE_TAXONOMY.length);
  assert.deepEqual(resolveProjectModules({ key: 'MOB', modules: [] }), []);
});
