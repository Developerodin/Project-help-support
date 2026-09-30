import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { canTransitionQaStatus, nextQaStatusOptions, ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../project.model.js';
import { ApiError } from '../../../platform/errors.js';
import {
  mergeModuleQaData,
  addUiQaComment,
  updateUiQaStatus,
  getUiQaProject,
  downloadUiQaAttachment,
} from '../ui-qa.service.js';

withMemoryDb();

const developer = (over = {}) => User.create({
  name: 'Dev User',
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role: ROLE_IDS.DEVELOPER,
  roles: [ROLE_IDS.DEVELOPER],
  ...over,
});

const readOnlyUser = (over = {}) => User.create({
  name: 'Read Only',
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role: ROLE_IDS.READ_ONLY,
  roles: [ROLE_IDS.READ_ONLY],
  ...over,
});

async function seedProject() {
  return Project.create({
    key: 'QA1',
    name: 'QA Project',
    createdBy: new mongoose.Types.ObjectId(),
    modules: [{
      key: 'mod-ats',
      label: 'ATS',
      qaStatus: 'open',
      comments: [],
      pages: [{
        key: 'page-jobs',
        label: 'Jobs',
        path: '/ats/jobs',
        qaStatus: 'open',
        comments: [],
        screens: [{
          key: 'screen-create',
          name: 'Create Job',
          route: '/ats/jobs/create',
          qaStatus: 'open',
          comments: [],
        }, {
          key: 'screen-list',
          name: 'Jobs List',
          route: '/ats/jobs',
          qaStatus: 'open',
          comments: [],
        }],
      }],
    }],
  });
}

test('allows the authoritative status transitions', () => {
  assert.equal(canTransitionQaStatus('open', 'review'), true);
  assert.equal(canTransitionQaStatus('review', 'in_progress'), true);
  assert.equal(canTransitionQaStatus('in_progress', 'done'), true);
  assert.equal(canTransitionQaStatus('done', 'open'), true);
  assert.equal(canTransitionQaStatus('done', 'review'), true);
  assert.equal(canTransitionQaStatus('open', 'done'), false);
});

test('exposes reopen targets from done', () => {
  assert.deepEqual(nextQaStatusOptions('done'), ['open', 'review']);
});

test('parseUiQaJsonField rejects missing or invalid entity payloads', async () => {
  const { parseUiQaJsonField } = await import('../project.controller.js');
  const { ApiError } = await import('../../../platform/errors.js');

  assert.throws(() => parseUiQaJsonField(undefined, 'entity'), (err) => (
    err instanceof ApiError && err.statusCode === 400 && err.message.includes('required')
  ));
  assert.throws(() => parseUiQaJsonField('undefined', 'entity'), (err) => (
    err instanceof ApiError && err.statusCode === 400
  ));
  assert.throws(() => parseUiQaJsonField('{', 'entity'), (err) => (
    err instanceof ApiError && err.statusCode === 400 && err.message.includes('valid JSON')
  ));
  assert.deepEqual(
    parseUiQaJsonField('{"level":"page","moduleKey":"main"}', 'entity'),
    { level: 'page', moduleKey: 'main' },
  );
});

test('preserves QA fields when catalog labels change but keys match', () => {
  const existing = [{
    key: 'mod-1',
    label: 'ATS',
    qaStatus: 'review',
    comments: [{ content: 'Needs polish', commentedBy: '507f1f77bcf86cd799439011' }],
    pages: [{
      key: 'page-1',
      label: 'Jobs',
      qaStatus: 'open',
      screens: [{
        key: 'screen-1',
        name: 'Jobs List',
        qaStatus: 'done',
      }],
    }],
  }];

  const incoming = [{
    key: 'mod-1',
    label: 'ATS (renamed)',
    pages: [{
      key: 'page-1',
      label: 'Jobs board',
      path: '/ats/jobs',
      screens: [{
        key: 'screen-1',
        name: 'Jobs List',
        type: 'list',
        status: 'active',
      }],
    }],
  }];

  const merged = mergeModuleQaData(existing, incoming);
  assert.equal(merged[0].qaStatus, 'review');
  assert.equal(merged[0].comments.length, 1);
  assert.equal(merged[0].pages[0].qaStatus, 'open');
  assert.equal(merged[0].pages[0].screens[0].qaStatus, 'done');
  assert.equal(merged[0].label, 'ATS (renamed)');
});

test('isolates comments and status per entity', async () => {
  const actor = await developer();
  const project = await seedProject();

  const createJob = {
    level: 'screen',
    moduleKey: 'mod-ats',
    pageKey: 'page-jobs',
    screenKey: 'screen-create',
  };
  const jobsPage = {
    level: 'page',
    moduleKey: 'mod-ats',
    pageKey: 'page-jobs',
  };

  await addUiQaComment(project.id, createJob, { content: 'Create Job only' }, actor, null);
  await updateUiQaStatus(project.id, createJob, { status: 'review' }, actor, null);
  await updateUiQaStatus(project.id, createJob, { status: 'in_progress' }, actor, null);

  const refreshed = await getUiQaProject(project.id, actor, null);
  const mod = refreshed.modules[0];
  const page = mod.pages[0];
  const createScreen = page.screens.find((row) => row.key === 'screen-create');
  const listScreen = page.screens.find((row) => row.key === 'screen-list');

  assert.equal(createScreen.comments.length, 1);
  assert.equal(createScreen.comments[0].content, 'Create Job only');
  assert.equal(createScreen.qaStatus, 'in_progress');
  assert.equal(listScreen.comments.length, 0);
  assert.equal(listScreen.qaStatus, 'open');
  assert.equal(page.comments.length, 0);
  assert.equal(page.qaStatus, 'open');
  assert.equal(mod.comments.length, 0);
  assert.equal(mod.qaStatus, 'open');

  await addUiQaComment(project.id, jobsPage, { content: 'Jobs page note' }, actor, null);
  const afterPageComment = await getUiQaProject(project.id, actor, null);
  const pageAfter = afterPageComment.modules[0].pages[0];
  const createAfter = pageAfter.screens.find((row) => row.key === 'screen-create');

  assert.equal(pageAfter.comments.length, 1);
  assert.equal(createAfter.comments.length, 1);
  assert.notEqual(pageAfter.comments[0].content, createAfter.comments[0].content);
});

test('records workflow transitions and blocks unauthorized status updates', async () => {
  const actor = await developer();
  const blocked = await readOnlyUser();
  const project = await seedProject();
  const entity = {
    level: 'screen',
    moduleKey: 'mod-ats',
    pageKey: 'page-jobs',
    screenKey: 'screen-create',
  };

  await updateUiQaStatus(project.id, entity, { status: 'review', note: 'Ready' }, actor, null);
  await updateUiQaStatus(project.id, entity, { status: 'in_progress' }, actor, null);
  await updateUiQaStatus(project.id, entity, { status: 'done' }, actor, null);
  await updateUiQaStatus(project.id, entity, { status: 'open', note: 'Reopen' }, actor, null);

  const refreshed = await getUiQaProject(project.id, actor, null);
  const screen = refreshed.modules[0].pages[0].screens.find((row) => row.key === 'screen-create');
  assert.equal(screen.qaStatus, 'open');
  assert.equal(screen.qaStatusHistory.length, 4);
  assert.equal(screen.qaStatusHistory[0].to, 'review');
  assert.equal(screen.qaStatusHistory[0].note, 'Ready');
  assert.equal(screen.qaStatusHistory[3].from, 'done');
  assert.equal(screen.qaStatusHistory[3].to, 'open');

  await assert.rejects(
    () => updateUiQaStatus(project.id, entity, { status: 'review' }, blocked, null),
    (err) => err instanceof ApiError && err.statusCode === 403,
  );
});

test('downloadUiQaAttachment presigns entity-scoped attachments', async () => {
  const actor = await developer();
  const project = await seedProject();
  const entity = {
    level: 'screen',
    moduleKey: 'mod-ats',
    pageKey: 'page-jobs',
    screenKey: 'screen-create',
  };
  const attachmentId = new mongoose.Types.ObjectId();
  const screen = project.modules[0].pages[0].screens[0];
  screen.attachments = [{
    _id: attachmentId,
    key: 'ui-qa/test-file.png',
    name: 'screenshot.png',
    size: 1024,
    mimeType: 'image/png',
    uploadedBy: actor._id,
    uploadedAt: new Date(),
  }];
  await project.save();

  const config = {
    features: { attachments: true },
    storage: { region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' },
  };
  const presignCalls = [];
  const storage = {
    presignGet: async (_cfg, key, opts) => {
      presignCalls.push({ key, opts });
      return `https://signed.example/${key}`;
    },
  };

  const { url, attachment } = await downloadUiQaAttachment(
    project.id,
    entity,
    attachmentId,
    config,
    actor,
    null,
    { storage },
  );

  assert.equal(url, 'https://signed.example/ui-qa/test-file.png');
  assert.equal(attachment.name, 'screenshot.png');
  assert.equal(presignCalls[0].key, 'ui-qa/test-file.png');
  assert.equal(presignCalls[0].opts?.filename, 'screenshot.png');
});

test('downloadUiQaAttachment finds attachments on comments', async () => {
  const actor = await developer();
  const project = await seedProject();
  const entity = {
    level: 'screen',
    moduleKey: 'mod-ats',
    pageKey: 'page-jobs',
    screenKey: 'screen-create',
  };
  const attachmentId = new mongoose.Types.ObjectId();
  const screen = project.modules[0].pages[0].screens[0];
  screen.comments = [{
    _id: new mongoose.Types.ObjectId(),
    content: 'See attached',
    commentedBy: actor._id,
    attachments: [{
      _id: attachmentId,
      key: 'ui-qa/comment-file.pdf',
      name: 'spec.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      uploadedBy: actor._id,
      uploadedAt: new Date(),
    }],
  }];
  await project.save();

  const config = {
    features: { attachments: true },
    storage: { region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' },
  };
  const presignCalls = [];
  const storage = {
    presignGet: async (_cfg, key, opts) => {
      presignCalls.push({ key, opts });
      return `https://signed.example/${key}`;
    },
  };

  const { url } = await downloadUiQaAttachment(
    project.id,
    entity,
    attachmentId,
    config,
    actor,
    null,
    { storage },
  );

  assert.equal(url, 'https://signed.example/ui-qa/comment-file.pdf');
  assert.equal(presignCalls[0].opts?.filename, 'spec.pdf');
});
