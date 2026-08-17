// backend/scripts/migrate-role-model-v2.js
import { ROLE_IDS } from '@pms/shared';
import { connectDb, disconnectDb } from '../src/platform/db.js';
import { loadConfig } from '../src/platform/config.js';
import logger from '../src/platform/logger.js';
import User from '../src/modules/users/user.model.js';

/**
 * Keys are the RETIRED literal `User.role` values, not permission
 * references — see Global Constraints. Values ARE ROLE_IDS.*.
 *
 * member -> READ_ONLY, not DEVELOPER: a legacy `member` had no distinct
 * backend behavior from developer/qa in the old flat model, but that is not
 * evidence it MEANT developer — granting create/update ticket capability on
 * a rename is a real privilege change dressed up as one. READ_ONLY is the
 * safe default; an admin explicitly promotes a genuine developer/tester/
 * support account afterward. See design spec §1.1.
 *
 * admin -> admin, not SUPER_ADMIN: who becomes the first Super Admin is a
 * manual, post-migration decision — see design spec §1.2.
 */
export const ROLE_MIGRATION_MAP = Object.freeze({
  admin: ROLE_IDS.ADMIN,
  lead: ROLE_IDS.PROJECT_ADMIN,
  qa: ROLE_IDS.TESTER,
  developer: ROLE_IDS.DEVELOPER,
  member: ROLE_IDS.READ_ONLY,
});

/** Read-only: counts existing users per old role value. Writes nothing. */
export async function planRoleMigration() {
  const counts = {};
  for (const oldRole of Object.keys(ROLE_MIGRATION_MAP)) {
    counts[oldRole] = await User.countDocuments({ role: oldRole });
  }
  return counts;
}

/** Idempotent — re-running after a partial apply only touches users still on an old role value. */
export async function applyRoleMigration() {
  const results = {};
  for (const [oldRole, newRole] of Object.entries(ROLE_MIGRATION_MAP)) {
    if (oldRole === newRole) { results[oldRole] = 0; continue; }
    const { modifiedCount } = await User.updateMany({ role: oldRole }, { $set: { role: newRole } });
    results[oldRole] = modifiedCount;
  }
  return results;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config = loadConfig();
  await connectDb(config.mongoUrl);
  try {
    const plan = await planRoleMigration();
    const total = Object.values(plan).reduce((a, b) => a + b, 0);
    logger.info(`Role migration ${apply ? 'APPLY' : 'DRY RUN'}: ${JSON.stringify(plan)} (${total} users)`);
    if (plan.member > 0) {
      logger.info(
        `${plan.member} user(s) currently 'member' will become 'read_only' (safe default — `
        + 'promote genuine developers/testers/support manually afterward). See design spec §1.1.',
      );
    }
    if (apply) {
      const results = await applyRoleMigration();
      logger.info(`Applied: ${JSON.stringify(results)}`);
    } else {
      logger.info('Dry run only — re-run with --apply to write changes.');
    }
  } finally {
    await disconnectDb();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { logger.error(err); process.exitCode = 1; });
}
