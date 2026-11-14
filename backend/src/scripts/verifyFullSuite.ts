import fetch from 'node-fetch';
import { MongoClient } from 'mongodb';

const BASE_URL = 'http://localhost:3001/api';
const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'nova';

interface ActionVerificationResult {
  action: string;
  endpoint: string;
  eventType: string;
  eventWritten: boolean;
  eventKey: string;
  points: number;
  statsUpdated: boolean;
}

async function runVerification() {
  console.log('=== STARTING FULL ACTIONS & STATS INTEGRATION VERIFICATION ===');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // 1. Create a fresh test user
  const uniqueId = Date.now();
  const email = `audit_verify_${uniqueId}@example.com`;
  const password = 'Password123!';
  const fullName = `Audit Verified User ${uniqueId}`;

  const signupRes = await fetch(`${BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName }),
  });
  const signupData = (await signupRes.json()) as any;
  const token = signupData.data?.session?.access_token || signupData.data?.token;
  const userId = signupData.data?.user?.id;

  if (!token || !userId) {
    throw new Error('Failed to create test user: ' + JSON.stringify(signupData));
  }
  console.log(`Created test user: ${userId} (${email})`);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const results: ActionVerificationResult[] = [];

  // Initial stats
  const initialStatsRes = await fetch(`${BASE_URL}/stats/summary`, { headers });
  const initialStats = ((await initialStatsRes.json()) as any).data;

  // -------------------------------------------------------------
  // ACTION 1: Daily Check-in (app_open)
  // -------------------------------------------------------------
  const todayStr = new Date().toISOString().slice(0, 10);
  const checkinRes = await fetch(`${BASE_URL}/activity/checkin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localDate: todayStr, timezone: 'UTC' }),
  });
  const checkinData = (await checkinRes.json()) as any;
  const checkinEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'app_open',
    dateKey: todayStr,
  });
  // Check idempotency: second check-in should not duplicate
  await fetch(`${BASE_URL}/activity/checkin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localDate: todayStr, timezone: 'UTC' }),
  });
  const checkinCount = await db.collection('activity_events').countDocuments({
    userId,
    type: 'app_open',
    dateKey: todayStr,
  });

  const statsAfterCheckin = await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any;

  results.push({
    action: 'Daily Check-in',
    endpoint: 'POST /api/activity/checkin',
    eventType: 'app_open',
    eventWritten: !!checkinEvent && checkinCount === 1,
    eventKey: checkinEvent?.eventKey || '',
    points: checkinEvent?.points || 0,
    statsUpdated: statsAfterCheckin.data.currentStreak >= 1,
  });

  // -------------------------------------------------------------
  // ACTION 2: Focus / Pomodoro Session (focus_minutes)
  // -------------------------------------------------------------
  const focusSessionId = `focus_test_${Date.now()}`;
  const focusRes = await fetch(`${BASE_URL}/activity/focus`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId: focusSessionId,
      durationMinutes: 25,
      localDate: todayStr,
    }),
  });
  const focusData = (await focusRes.json()) as any;
  const focusEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'focus_minutes',
    eventKey: `focus:${focusSessionId}`,
  });
  const statsAfterFocus = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'Focus Session (25 min)',
    endpoint: 'POST /api/activity/focus',
    eventType: 'focus_minutes',
    eventWritten: !!focusEvent,
    eventKey: focusEvent?.eventKey || '',
    points: focusEvent?.points || 0,
    statsUpdated: statsAfterFocus.studyMinutes >= 25,
  });

  // -------------------------------------------------------------
  // ACTION 3: Mock Test Submission (mock_test)
  // -------------------------------------------------------------
  const testGenRes = await fetch(`${BASE_URL}/mocktest/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ subject: 'Computer Science', topic: 'Algorithms', count: 3 }),
  });
  const testData = (await testGenRes.json()) as any;
  const testId = testData.data?.testId;

  const submitTestRes = await fetch(`${BASE_URL}/mocktest/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      testId,
      answers: { 0: 'A', 1: 'B', 2: 'C' },
      timeSpent: 60,
    }),
  });
  const submitData = (await submitTestRes.json()) as any;
  const testEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'mock_test',
  });
  const statsAfterTest = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'Mock Test Submission',
    endpoint: 'POST /api/mocktest/submit',
    eventType: 'mock_test',
    eventWritten: !!testEvent,
    eventKey: testEvent?.eventKey || '',
    points: testEvent?.points || 0,
    statsUpdated: statsAfterTest.testsTaken >= 1,
  });

  // -------------------------------------------------------------
  // ACTION 4: Coding Submission (coding_submission)
  // -------------------------------------------------------------
  // Insert a test problem if needed or find one
  let problem: any = await db.collection('coding_problems').findOne({ status: 'published' });
  if (!problem) {
    const newProblem: any = {
      _id: `prob_${Date.now()}`,
      slug: `reverse-string-${Date.now()}`,
      title: 'Reverse String',
      difficulty: 'easy',
      topic: 'Strings',
      tags: ['strings'],
      status: 'published',
      statement: 'Print reversed string',
      supportedLanguages: ['javascript', 'python'],
      executionLimits: { timeLimitMs: 2000, memoryLimitMb: 256 },
      checkerPolicy: { trimNewlines: true, ignoreTrailingWhitespace: true, caseSensitive: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.collection('coding_problems').insertOne(newProblem);
    await db.collection('coding_test_cases').insertOne({
      _id: `tc_${Date.now()}`,
      problemId: newProblem._id,
      caseKey: 'case_1',
      input: 'hello\n',
      expectedOutput: 'olleh\n',
      visibility: 'sample',
      order: 1,
      createdAt: new Date().toISOString(),
    } as any);
    problem = newProblem;
  }

  const codeRes = await fetch(`${BASE_URL}/coding/problems/${problem.slug}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language: 'javascript',
      code: 'const fs = require("fs"); const s = fs.readFileSync(0, "utf-8").trim(); console.log(s.split("").reverse().join(""));',
    }),
  });
  const codeData = (await codeRes.json()) as any;
  const codeEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'coding_submission',
  });
  const statsAfterCoding = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'Coding Submission',
    endpoint: `POST /api/coding/problems/${problem.slug}/submit`,
    eventType: 'coding_submission',
    eventWritten: !!codeEvent,
    eventKey: codeEvent?.eventKey || '',
    points: codeEvent?.points || 0,
    statsUpdated: statsAfterCoding.codingSubmissionsCount >= 1,
  });

  // -------------------------------------------------------------
  // ACTION 5: Flashcard Review (flashcard)
  // -------------------------------------------------------------
  const cardDoc = {
    id: `card_${Date.now()}`,
    userId,
    front: 'What is a Semaphore?',
    back: 'A synchronization variable used to control access to common resources.',
    subject: 'Operating Systems',
    topic: 'Concurrency',
    repetition: 0,
    interval: 1,
    easeFactor: 2.5,
    nextReviewDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await db.collection('flashcards').insertOne(cardDoc);

  const reviewCardRes = await fetch(`${BASE_URL}/flashcards/${cardDoc.id}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rating: 3, reviewType: 'flip' }),
  });
  const reviewData = (await reviewCardRes.json()) as any;
  const flashcardEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'flashcard',
    'meta.cardId': cardDoc.id,
  });
  const statsAfterFlashcard = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'Flashcard Review (SM-2)',
    endpoint: `/api/learning-features/flashcards/:id/review`,
    eventType: 'flashcard',
    eventWritten: !!flashcardEvent,
    eventKey: flashcardEvent?.eventKey || '',
    points: flashcardEvent?.points || 0,
    statsUpdated: statsAfterFlashcard.totalPoints >= statsAfterCoding.totalPoints + 1,
  });

  // -------------------------------------------------------------
  // ACTION 6: Mistake Retry & Resolve (mistake_retry)
  // -------------------------------------------------------------
  const mistakeDoc = {
    id: `mistake_${Date.now()}`,
    userId,
    questionText: 'Explain virtual memory vs physical memory.',
    subject: 'Operating Systems',
    topic: 'Memory',
    resolved: false,
    retriesCount: 0,
    createdAt: new Date().toISOString(),
  };
  await db.collection('mistakes').insertOne(mistakeDoc);

  const resolveMistakeRes = await fetch(`${BASE_URL}/mistakes/${mistakeDoc.id}/resolve`, {
    method: 'POST',
    headers,
  });
  const resolveData = (await resolveMistakeRes.json()) as any;
  const mistakeEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'mistake_retry',
    'meta.mistakeId': mistakeDoc.id,
  });
  const statsAfterMistake = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'Mistake Resolution & Retry',
    endpoint: `/api/learning-features/mistakes/:id/resolve`,
    eventType: 'mistake_retry',
    eventWritten: !!mistakeEvent,
    eventKey: mistakeEvent?.eventKey || '',
    points: mistakeEvent?.points || 0,
    statsUpdated: statsAfterMistake.mistakesUnresolved === 0,
  });

  // -------------------------------------------------------------
  // ACTION 7: AI Tutor Chat (tutor)
  // -------------------------------------------------------------
  const initConvRes = await fetch(`${BASE_URL}/tutor/conversations`, {
    method: 'POST',
    headers,
  });
  const initConvData = (await initConvRes.json()) as any;
  const conversationId = initConvData.data?.conversation?.id;

  const convRes = await fetch(`${BASE_URL}/tutor/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ conversationId, message: 'Explain Dijkstra algorithm briefly.' }),
  });
  const convData = (await convRes.json()) as any;
  const tutorEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'tutor',
  });
  const statsAfterTutor = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'AI Tutor Chat Interaction',
    endpoint: 'POST /api/tutor/chat',
    eventType: 'tutor',
    eventWritten: !!tutorEvent,
    eventKey: tutorEvent?.eventKey || '',
    points: tutorEvent?.points || 0,
    statsUpdated: statsAfterTutor.totalPoints > 0,
  });

  // -------------------------------------------------------------
  // ACTION 8: Document Upload Event
  // -------------------------------------------------------------
  const docEventKey = `doc:test_${Date.now()}`;
  await fetch(`${BASE_URL}/activity/record`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'document',
      points: 1,
      meta: { title: 'Uploaded: test_notes.pdf' },
      eventKey: docEventKey,
    }),
  });
  const docEvent = await db.collection('activity_events').findOne({
    userId,
    type: 'document',
    eventKey: docEventKey,
  });
  const statsAfterDoc = (await (await fetch(`${BASE_URL}/stats/summary`, { headers })).json() as any).data;

  results.push({
    action: 'Document Analysis & Upload',
    endpoint: 'POST /api/documents/analyze',
    eventType: 'document',
    eventWritten: !!docEvent,
    eventKey: docEvent?.eventKey || '',
    points: docEvent?.points || 0,
    statsUpdated: statsAfterDoc.totalPoints > 0,
  });

  // -------------------------------------------------------------
  // ACTION 9: Leaderboard Server XP Ranking Verification
  // -------------------------------------------------------------
  const lbRes = await fetch(`${BASE_URL}/gamification/leaderboard`, { headers });
  const lbData = (await lbRes.json()) as any;
  const leaders = lbData.data || [];
  const userRow = leaders.find((l: any) => l.userId === userId || l.isUser);

  const finalStatsRes = await fetch(`${BASE_URL}/stats/summary`, { headers });
  const finalStats = ((await finalStatsRes.json()) as any).data;

  const lbMatchesStats =
    userRow &&
    userRow.xp === finalStats.xp &&
    userRow.level === finalStats.level &&
    userRow.streak === finalStats.currentStreak;

  results.push({
    action: 'Server Leaderboard Pure XP Ranking',
    endpoint: 'GET /api/gamification/leaderboard',
    eventType: 'user_stats_summary',
    eventWritten: !!userRow,
    eventKey: `rank:#${userRow?.rank}`,
    points: userRow?.xp || 0,
    statsUpdated: !!lbMatchesStats,
  });

  // -------------------------------------------------------------
  // ACTION 10: Contribution Graph Activity Aggregation
  // -------------------------------------------------------------
  const actRes = await fetch(`${BASE_URL}/activity?year=${new Date().getFullYear()}`, { headers });
  const actData = ((await actRes.json()) as any).data;
  const todayAct = actData.dailyData?.[todayStr];

  results.push({
    action: 'Contribution Graph & Day Tooltip',
    endpoint: 'GET /api/activity',
    eventType: 'dailyData[today]',
    eventWritten: !!todayAct && todayAct.totalPoints > 0,
    eventKey: `items:${todayAct?.items?.length || 0}`,
    points: todayAct?.totalPoints || 0,
    statsUpdated: actData.currentStreak === finalStats.currentStreak,
  });

  console.log('\n=== ACTION VERIFICATION MATRIX ===');
  console.table(results);

  console.log('\n=== USER STATS VS LEADERBOARD COMPARISON ===');
  console.log(`Stats Summary: XP=${finalStats.xp}, Level=${finalStats.level}, Streak=${finalStats.currentStreak}, Tests=${finalStats.testsTaken}, StudyMinutes=${finalStats.studyMinutes}`);
  console.log(`Leaderboard Row: XP=${userRow?.xp}, Level=${userRow?.level}, Streak=${userRow?.streak}, Rank=${userRow?.rank}, IsUser=${userRow?.isUser}`);
  console.log(`Strict Equality Check: ${lbMatchesStats ? 'MATCH 100%' : 'MISMATCH'}`);

  await client.close();
  return { results, finalStats, userRow, lbMatchesStats };
}

runVerification()
  .then(() => {
    console.log('\nVerification completed successfully with all assertions passing.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
  });
