import { getDb } from './db.js';
import { activityStore, type ActivityEventType, type ActivityEventDoc } from './activityStore.js';
import { getDateKeyForTimezone } from './timezone.js';
import { computeUserStatsSummary } from '../routes/stats.js';

export interface BackfillResult {
  userId: string;
  assessmentsProcessed: number;
  sessionsProcessed: number;
  interviewsProcessed: number;
  documentsProcessed: number;
  codingProcessed: number;
  flashcardsProcessed: number;
  totalEventsCreated: number;
}

export async function backfillUserActivity(userId: string): Promise<BackfillResult> {
  const db = await getDb();
  let totalEventsCreated = 0;

  // Resolve user timezone
  const user = await db.collection('users').findOne({ $or: [{ id: userId }, { _id: userId as any }] });
  const userTimezone = user?.timezone || 'Asia/Kolkata';

  // 1. Assessment results (Mock tests)
  // Skip records with no valid submission/completion timestamp
  const assessments = await db.collection('assessment_results').find({ userId }).toArray();
  let assessmentsProcessed = 0;
  for (const a of assessments) {
    const rawDate = a.takenAt || a.submittedAt || a.completedAt || a.createdAt;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = a.id || a.resultId || a.testId || String(a._id);
    const eventKey = `mock_test:${sourceId}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'mock_test',
      dateKey,
      4,
      {
        testId: a.testId || a.id,
        resultId: a.id,
        scorePercent: a.scorePercent,
        subject: a.subject,
        title: a.subject ? `${a.subject} Mock Test (${a.scorePercent || 0}%)` : 'Mock Test Completed',
      },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    assessmentsProcessed++;
  }

  // Also check mock_test_attempts if any submitted attempts are not yet in assessment_results
  const attempts = await db.collection('mock_test_attempts').find({ userId, status: 'submitted' }).toArray();
  for (const att of attempts) {
    const rawDate = att.updatedAt || att.createdAt;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = att.resultId || att.id;
    const eventKey = `mock_test:${sourceId}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'mock_test',
      dateKey,
      4,
      {
        testId: att.id,
        resultId: att.resultId,
        subject: att.subject,
        title: `${att.subject || 'Mock'} Test`,
      },
      eventKey
    );
    if (recorded) totalEventsCreated++;
  }

  // 2. Study sessions (Points: 3)
  const sessions = await db.collection('study_sessions').find({ userId, status: 'completed' }).toArray();
  let sessionsProcessed = 0;
  for (const s of sessions) {
    const rawDate = s.completedAt || s.submittedAt || s.createdAt || s.date;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = s.id || String(s._id);
    const eventKey = `session:${sourceId}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'session',
      dateKey,
      3,
      { sessionId: sourceId, title: s.title || 'Study Session' },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    sessionsProcessed++;
  }

  // 3. Interview reports (Points: 4)
  const interviews = await db.collection('interview_reports').find({ userId }).toArray();
  let interviewsProcessed = 0;
  for (const i of interviews) {
    const rawDate = i.createdAt || i.completedAt || i.submittedAt;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = i.id || String(i._id);
    const eventKey = `interview:${sourceId}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'interview',
      dateKey,
      4,
      {
        reportId: sourceId,
        interviewId: sourceId,
        overallScore: i.overallScore,
        role: i.role,
        topic: i.topic,
        title: `Interview: ${i.role || 'Practice'} (${i.overallScore || 0}%)`,
      },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    interviewsProcessed++;
  }

  // 4. Documents (Points: 1)
  const documents = await db.collection('documents').find({ userId }).toArray();
  let documentsProcessed = 0;
  for (const d of documents) {
    const rawDate = d.uploadedAt || d.createdAt;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = d.id || String(d._id);
    const eventKey = `document:${sourceId}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'document',
      dateKey,
      1,
      { docId: sourceId, filename: d.filename || d.title || d.fileName, title: `Uploaded: ${d.filename || d.fileName || 'Document'}` },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    documentsProcessed++;
  }

  // 5. Coding submissions (Points: 3 for accepted, 1 otherwise)
  const codingSubs = await db.collection('coding_submissions').find({ userId }).toArray();
  let codingProcessed = 0;
  for (const c of codingSubs) {
    const rawDate = c.createdAt || c.submittedAt;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = c._id || c.id || c.submissionId;
    const eventKey = `coding_submission:${sourceId}`;
    const isAccepted = c.verdict === 'accepted' || c.verdict === 'Accepted' || c.status === 'accepted';
    const points = isAccepted ? 3 : 1;
    const recorded = await activityStore.recordActivity(
      userId,
      'coding_submission',
      dateKey,
      points,
      {
        submissionId: sourceId,
        problemId: c.problemId,
        problemSlug: c.problemSlug,
        verdict: c.verdict,
        title: `Coding: ${c.problemTitle || c.problemSlug || 'Problem'} (${c.verdict || 'submitted'})`,
      },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    codingProcessed++;
  }

  // 6. Flashcards with lastReviewedAt (Points: 1)
  const flashcards = await db
    .collection('flashcards')
    .find({ userId, lastReviewedAt: { $exists: true, $ne: null } })
    .toArray();
  let flashcardsProcessed = 0;
  for (const f of flashcards) {
    const rawDate = f.lastReviewedAt || f.updatedAt || f.createdAt;
    if (!rawDate || isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const dateKey = getDateKeyForTimezone(new Date(rawDate), userTimezone);
    const sourceId = f.id || String(f._id);
    const eventKey = `flashcard:${sourceId}:${dateKey}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'flashcard',
      dateKey,
      1,
      { flashcardId: sourceId, title: 'Flashcard Reviewed' },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    flashcardsProcessed++;
  }

  // Execute cleanup & repair to guarantee no duplicate events or wrong dates remain
  await cleanupAndRepairUserActivity(userId);

  return {
    userId,
    assessmentsProcessed,
    sessionsProcessed,
    interviewsProcessed,
    documentsProcessed,
    codingProcessed,
    flashcardsProcessed,
    totalEventsCreated,
  };
}

/**
 * Deduplicates activity events, repairs wrong dates (e.g. 2026-08-15 mock test),
 * fixes session points to 3, and updates streak & user_stats.
 */
export async function cleanupAndRepairUserActivity(userId: string): Promise<{
  duplicatesRemoved: number;
  datesRepaired: number;
  pointsRepaired: number;
}> {
  const db = await getDb();
  let duplicatesRemoved = 0;
  let datesRepaired = 0;
  let pointsRepaired = 0;

  const user = await db.collection('users').findOne({ $or: [{ id: userId }, { _id: userId as any }] });
  const userTimezone = user?.timezone || 'Asia/Kolkata';
  const todayKey = getDateKeyForTimezone(new Date(), userTimezone);

  // 1. REPAIR MOCK TEST WRONG DATES (e.g. 2026-08-15 account creation date)
  const assessments = await db.collection('assessment_results').find({ userId }).toArray();
  const mockAttempts = await db.collection('mock_test_attempts').find({ userId }).toArray();

  // Find real timestamp from assessments or attempts
  let realTestTimestamp: string | number | null = null;
  let realTestResultId: string | null = null;
  let realTestScore: number = 0;
  let realTestSubject: string = 'Full';

  for (const a of assessments) {
    const ts = a.takenAt || a.submittedAt || a.completedAt || a.createdAt;
    if (ts && !isNaN(new Date(ts).getTime())) {
      // Choose non-account-creation date (e.g. November 2026)
      const dKey = getDateKeyForTimezone(new Date(ts), userTimezone);
      if (dKey !== '2026-08-15' || !realTestTimestamp) {
        realTestTimestamp = ts;
        realTestResultId = a.id || a.testId;
        realTestScore = Number(a.scorePercent) || 0;
        realTestSubject = a.subject || 'Full';
      }
    }
  }

  if (!realTestTimestamp) {
    for (const att of mockAttempts) {
      const ts = att.updatedAt || att.createdAt;
      if (ts && !isNaN(new Date(ts).getTime())) {
        const dKey = getDateKeyForTimezone(new Date(ts), userTimezone);
        if (dKey !== '2026-08-15' || !realTestTimestamp) {
          realTestTimestamp = ts;
          realTestResultId = att.resultId || att.id;
          realTestSubject = att.subject || 'Full';
        }
      }
    }
  }

  // If realTestTimestamp is found, convert to dateKey
  const realTestDateKey = realTestTimestamp
    ? getDateKeyForTimezone(new Date(realTestTimestamp), userTimezone)
    : todayKey;

  // Search for any mock_test activity events with dateKey '2026-08-15'
  const wrongDateEvents = await db
    .collection<ActivityEventDoc>('activity_events')
    .find({ userId, type: 'mock_test', dateKey: '2026-08-15' })
    .toArray();

  for (const ev of wrongDateEvents) {
    await db.collection('activity_events').updateOne(
      { _id: ev._id as any },
      {
        $set: {
          dateKey: realTestDateKey,
          points: 4,
          eventKey: `mock_test:${realTestResultId || ev.meta?.resultId || ev.meta?.testId || 'repaired'}`,
          'meta.title': `${realTestSubject} Mock Test (${realTestScore}%)`,
        },
      }
    );
    datesRepaired++;
  }

  // 2. REPAIR SESSION POINTS (Ensure 3 points, not 1)
  const sessionEventsWith1Pt = await db
    .collection<ActivityEventDoc>('activity_events')
    .find({ userId, type: 'session', points: { $ne: 3 } })
    .toArray();

  for (const ev of sessionEventsWith1Pt) {
    await db.collection('activity_events').updateOne(
      { _id: ev._id as any },
      { $set: { points: 3 } }
    );
    pointsRepaired++;
  }

  // 3. REMOVE DUPLICATE INTERVIEW EVENTS
  // Look up interview reports to map mongo _id to custom id
  const interviewReports = await db.collection('interview_reports').find({ userId }).toArray();
  const allInterviewEvents = await db
    .collection<ActivityEventDoc>('activity_events')
    .find({ userId, type: 'interview' })
    .toArray();

  // Deduplicate interview events: keep only 1 event per interview
  for (const rep of interviewReports) {
    const rId = rep.id;
    const mongoId = String(rep._id);
    const canonicalKey = `interview:${rId || mongoId}`;

    // Find all events matching either key or reportId
    const matching = allInterviewEvents.filter((ev) => {
      const ek = ev.eventKey || '';
      return (
        ek === canonicalKey ||
        ek === `interview:${mongoId}` ||
        ek === `interview:${rId}` ||
        ev.meta?.reportId === rId ||
        ev.meta?.interviewId === rId ||
        ev.meta?.reportId === mongoId
      );
    });

    if (matching.length > 1) {
      // Keep one, remove the others
      const [primary, ...duplicates] = matching;
      // Ensure primary has canonical key and 4 points
      await db.collection('activity_events').updateOne(
        { _id: primary._id as any },
        { $set: { eventKey: canonicalKey, points: 4 } }
      );
      for (const dup of duplicates) {
        await db.collection('activity_events').deleteOne({ _id: dup._id as any });
        duplicatesRemoved++;
      }
    }
  }

  // Also remove general duplicate interview events if interview count in events > interview_reports.length
  const refreshedInterviewEvents = await db
    .collection<ActivityEventDoc>('activity_events')
    .find({ userId, type: 'interview' })
    .sort({ createdAt: 1 })
    .toArray();

  if (interviewReports.length > 0 && refreshedInterviewEvents.length > interviewReports.length) {
    const keepCount = interviewReports.length;
    const surplus = refreshedInterviewEvents.slice(keepCount);
    for (const dup of surplus) {
      await db.collection('activity_events').deleteOne({ _id: dup._id as any });
      duplicatesRemoved++;
    }
  }

  // 4. GENERAL DEDUPLICATION (same type and eventKey)
  const allEvents = await db
    .collection<ActivityEventDoc>('activity_events')
    .find({ userId })
    .toArray();

  const seenKeys = new Set<string>();
  for (const ev of allEvents) {
    if (ev.eventKey) {
      if (seenKeys.has(ev.eventKey)) {
        await db.collection('activity_events').deleteOne({ _id: ev._id as any });
        duplicatesRemoved++;
      } else {
        seenKeys.add(ev.eventKey);
      }
    }
  }

  // 5. RECOMPUTE STREAK & MAINTAIN USER_STATS
  await activityStore.computeStreak(userId, todayKey);
  await computeUserStatsSummary(userId, userTimezone, todayKey);

  return {
    duplicatesRemoved,
    datesRepaired,
    pointsRepaired,
  };
}

export async function backfillAllUsersActivity(): Promise<BackfillResult[]> {
  const db = await getDb();
  const users = await db.collection('users').find({}, { projection: { _id: 1, id: 1 } }).toArray();
  const results: BackfillResult[] = [];

  for (const u of users) {
    const userId = u.id || String(u._id);
    const res = await backfillUserActivity(userId);
    results.push(res);
  }

  return results;
}
