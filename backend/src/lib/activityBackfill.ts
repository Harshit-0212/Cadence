import { getDb } from './db.js';
import { activityStore } from './activityStore.js';

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

  // 1. Assessment results
  const assessments = await db.collection('assessment_results').find({ userId }).toArray();
  let assessmentsProcessed = 0;
  for (const a of assessments) {
    const rawDate = a.takenAt || a.createdAt;
    const dateKey = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const eventKey = `mock_test:${a._id || a.testId}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'mock_test',
      dateKey,
      4,
      { testId: a.testId, scorePercent: a.scorePercent, subject: a.subject },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    assessmentsProcessed++;
  }

  // 2. Study sessions
  const sessions = await db.collection('study_sessions').find({ userId, status: 'completed' }).toArray();
  let sessionsProcessed = 0;
  for (const s of sessions) {
    const rawDate = s.completedAt || s.createdAt;
    const dateKey = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const eventKey = `session:${s._id}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'session',
      dateKey,
      3,
      { sessionId: String(s._id), title: s.title },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    sessionsProcessed++;
  }

  // 3. Interview reports
  const interviews = await db.collection('interview_reports').find({ userId }).toArray();
  let interviewsProcessed = 0;
  for (const i of interviews) {
    const rawDate = i.createdAt;
    const dateKey = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const eventKey = `interview:${i._id}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'interview',
      dateKey,
      4,
      { reportId: String(i._id), overallScore: i.overallScore },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    interviewsProcessed++;
  }

  // 4. Documents
  const documents = await db.collection('documents').find({ userId }).toArray();
  let documentsProcessed = 0;
  for (const d of documents) {
    const rawDate = d.uploadedAt || d.createdAt;
    const dateKey = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const eventKey = `document:${d._id}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'document',
      dateKey,
      1,
      { docId: String(d._id), filename: d.filename || d.title },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    documentsProcessed++;
  }

  // 5. Coding submissions
  const codingSubs = await db.collection('coding_submissions').find({ userId }).toArray();
  let codingProcessed = 0;
  for (const c of codingSubs) {
    const rawDate = c.createdAt || c.submittedAt;
    const dateKey = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const eventKey = `coding_submission:${c._id}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'coding_submission',
      dateKey,
      3,
      { submissionId: String(c._id), problemId: c.problemId },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    codingProcessed++;
  }

  // 6. Flashcards with lastReviewedAt
  const flashcards = await db.collection('flashcards').find({ userId, lastReviewedAt: { $exists: true, $ne: null } }).toArray();
  let flashcardsProcessed = 0;
  for (const f of flashcards) {
    const dateKey = new Date(f.lastReviewedAt).toISOString().slice(0, 10);
    const eventKey = `flashcard:${f._id}:${dateKey}`;
    const recorded = await activityStore.recordActivity(
      userId,
      'flashcard',
      dateKey,
      1,
      { flashcardId: String(f._id) },
      eventKey
    );
    if (recorded) totalEventsCreated++;
    flashcardsProcessed++;
  }

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

export async function backfillAllUsersActivity(): Promise<BackfillResult[]> {
  const db = await getDb();
  const users = await db.collection('users').find({}, { projection: { _id: 1 } }).toArray();
  const results: BackfillResult[] = [];

  for (const u of users) {
    const userId = String(u._id);
    const res = await backfillUserActivity(userId);
    results.push(res);
  }

  return results;
}

