/**
 * One-time migration: mark every comment predating the `internal` flag as internal.
 *
 * The product rule is that a comment is client-visible unless marked internal.
 * Applying that rule retroactively would publish notes written when no client
 * could ever read them, so history stays private and the rule governs everything
 * written from here on.
 *
 * DEPLOY-WINDOW ORDERING (CRITICAL):
 * - Run this migration BEFORE the filtered read path deploys (Task 12).
 * - RE-RUN immediately after cutover to catch any comments written by old code
 *   during the deployment window. The function is idempotent.
 *
 * Usage (from repo root):
 *   node backend/src/scripts/migrate-comments-internal.js --dry-run
 *   node backend/src/scripts/migrate-comments-internal.js
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import Ticket from '../modules/tickets/ticket.model.js';

export async function backfillCommentVisibility({ dryRun = false } = {}) {
  const filter = { comments: { $elemMatch: { internal: { $exists: false } } } };
  const affected = await Ticket.collection.find(filter, { projection: { comments: 1 } }).toArray();

  const comments = affected.reduce(
    (sum, doc) => sum + (doc.comments || []).filter((c) => c.internal === undefined).length,
    0,
  );

  if (!dryRun && comments > 0) {
    await Ticket.collection.updateMany(
      filter,
      { $set: { 'comments.$[missing].internal': true } },
      { arrayFilters: [{ 'missing.internal': { $exists: false } }] },
    );
  }

  return { tickets: affected.length, comments, dryRun };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.error('Set MONGODB_URI or DATABASE_URL');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--dry-run');
  if (unknownArgs.length > 0) {
    console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  const report = await backfillCommentVisibility({ dryRun });
  const verb = dryRun ? '[dry run] would mark' : 'Marked';
  console.log(`${verb} ${report.comments} comment(s) across ${report.tickets} ticket(s) internal`);
  await mongoose.disconnect();
}
