import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLE_IDS, ROLE_PERMISSIONS } from '@pms/shared';
import {
  startTestDb, stopTestDb, createActiveUser, bearerToken, grantRoleMatrixCustomization, getTestConfig,
} from '../../../test/test-harness.js';
import { createApp } from '../../../app.js';
import { updateRoleMatrix } from '../../rbac/rbac.service.js';

/*
 * The assistant is a role permission (assistant.use): on by default for every
 * role but unassigned, switchable per role below admin, and enforced on every
 * assistant endpoint.
 */
describe('assistant access by role', () => {
  let app;
  let config;
  let admin;

  const status = (user) => request(app).get('/v1/assistant').set('Authorization', bearerToken(user, config));
  const chat = (user) => request(app).post('/v1/assistant/chat')
    .set('Authorization', bearerToken(user, config))
    .send({ messages: [{ role: 'user', content: 'hi' }] });

  before(async () => {
    await startTestDb();
    config = {
      ...getTestConfig(),
      assistant: {
        apiKey: 'sk-test', chatModel: 'm', userDailyBudgetInr: 100, usdToInr: 88, budgetTimeZone: 'Asia/Kolkata',
        monthlyTokenBudget: 1_000_000, prices: { chatInputPerM: 1, chatOutputPerM: 1, transcribePerMin: 1, speechPerMin: 1 },
      },
    };
    app = createApp(config);
    admin = await createActiveUser({ email: 'admin-ai@example.com', roles: [ROLE_IDS.ADMIN] });
  });

  after(stopTestDb);

  it('is on by default for every role except unassigned', () => {
    for (const [role, bundle] of Object.entries(ROLE_PERMISSIONS)) {
      assert.equal(bundle.includes('assistant.use'), role !== ROLE_IDS.UNASSIGNED, role);
    }
  });

  it('shows for a role that has it, and hides (and refuses) for one that does not', async () => {
    const dev = await createActiveUser({ email: 'dev-ai@example.com', roles: [ROLE_IDS.DEVELOPER] });
    const nobody = await createActiveUser({ email: 'none-ai@example.com', roles: [ROLE_IDS.UNASSIGNED] });
    assert.equal((await status(dev)).body.enabled, true);
    assert.deepEqual((await status(nobody)).body, { enabled: false });
    const refused = await chat(nobody);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'ASSISTANT_NOT_ALLOWED');
  });

  it('switching it off for a role (internal or external) takes it away from that role only', async () => {
    const tester = await createActiveUser({ email: 'tester-ai@example.com', roles: [ROLE_IDS.TESTER] });
    const support = await createActiveUser({ email: 'support-ai@example.com', roles: [ROLE_IDS.SUPPORT] });
    const client = await createActiveUser({ email: 'client-ai@example.com', roles: [ROLE_IDS.CLIENT_TESTER] });
    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { remove: ['assistant.use'] });
    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.CLIENT_TESTER, { remove: ['assistant.use'] });

    assert.deepEqual((await status(tester)).body, { enabled: false });
    assert.equal((await chat(tester)).body.error.code, 'ASSISTANT_NOT_ALLOWED');
    assert.deepEqual((await status(client)).body, { enabled: false });
    assert.equal((await status(support)).body.enabled, true, 'other roles keep it');
  });

  it('admins always keep it: the role matrix refuses to switch it off for them', async () => {
    const matrix = Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, [...perms]]));
    matrix[ROLE_IDS.ADMIN] = matrix[ROLE_IDS.ADMIN].filter((permission) => permission !== 'assistant.use');
    await assert.rejects(
      updateRoleMatrix(admin, { grants: matrix }),
      (err) => err.code === 'MATRIX_SAFETY_VIOLATION' && /assistant\.use/.test(err.message),
    );
  });
});
