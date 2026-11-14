import { backfillAllUsersActivity } from '../lib/activityBackfill.js';
import { closeDb } from '../lib/db.js';

async function main() {
  console.log('[backfillActivity] Starting activity backfill for all users...');
  try {
    const results = await backfillAllUsersActivity();
    console.log(`[backfillActivity] Completed backfill for ${results.length} user(s):`);
    for (const r of results) {
      console.log(
        `User ${r.userId}: ` +
        `${r.assessmentsProcessed} tests, ` +
        `${r.sessionsProcessed} sessions, ` +
        `${r.interviewsProcessed} interviews, ` +
        `${r.documentsProcessed} docs, ` +
        `${r.codingProcessed} coding, ` +
        `${r.flashcardsProcessed} flashcards -> ` +
        `${r.totalEventsCreated} events recorded.`
      );
    }
  } catch (err) {
    console.error('[backfillActivity] Error during backfill:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();

