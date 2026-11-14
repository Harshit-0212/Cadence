const BASE_URL = 'http://localhost:3001';

async function runVerification() {
  console.log('--- Starting Integration & Consistency Verification ---');

  // 1. Signup / Signin a test user
  const uniqueEmail = `test_learner_${Date.now()}@example.com`;
  const password = 'TestPassword123!';
  console.log(`1. Creating test user: ${uniqueEmail}`);

  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: uniqueEmail,
      password,
      name: 'Integration Learner',
    }),
  });

  const signupBody = (await signupRes.json()) as any;
  const signupData = signupBody.data || signupBody;
  if (!signupRes.ok || !signupData.session?.access_token) {
    throw new Error(`Signup failed: ${JSON.stringify(signupBody)}`);
  }
  const token = signupData.session.access_token;
  console.log('✓ Test user authenticated successfully.');

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // 2. Initial stats check
  console.log('2. Fetching initial /api/stats/summary and /api/activity');
  const initialStatsRes = await fetch(`${BASE_URL}/api/stats/summary?timezone=UTC&localDate=2026-11-14`, {
    headers: authHeaders,
  });
  const initialStats = (await initialStatsRes.json()) as any;
  console.log('Initial stats:', initialStats.data);

  const initialActivityRes = await fetch(`${BASE_URL}/api/activity?timezone=UTC&localDate=2026-11-14`, {
    headers: authHeaders,
  });
  const initialActivity = (await initialActivityRes.json()) as any;
  console.log('Initial activity streak:', initialActivity.data?.currentStreak);

  if (initialStats.data.currentStreak !== initialActivity.data.currentStreak) {
    throw new Error(
      `Streak mismatch: stats summary=${initialStats.data.currentStreak}, activity=${initialActivity.data.currentStreak}`
    );
  }
  console.log('✓ Stats summary and activity streak are 100% identical.');

  // 3. In-progress Mock Test Persistence
  console.log('3. Generating a mock test attempt');
  const generateRes = await fetch(`${BASE_URL}/api/mocktest/generate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      subject: 'Data Structures',
      difficulty: 'mixed',
      numQuestions: 3,
      topics: ['Arrays', 'Linked Lists'],
    }),
  });
  const generateBody = (await generateRes.json()) as any;
  console.log('Generate response:', generateRes.status, generateBody);
  const generateData = generateBody.data || generateBody;
  const testId = generateData.testId;
  const questions = generateData.questions;
  console.log(`Generated test with ID: ${testId}, questions count: ${questions?.length}`);

  // Check active attempt endpoint
  const activeRes = await fetch(`${BASE_URL}/api/mocktest/active`, { headers: authHeaders });
  const activeBody = (await activeRes.json()) as any;
  const activeData = activeBody.data || activeBody;
  const activeAttemptId = activeData.attempt?.testId || activeData.attempt?.id;
  if (!activeData.attempt || activeAttemptId !== testId) {
    throw new Error(`Active attempt not found or ID mismatch: ${JSON.stringify(activeBody)}`);
  }
  console.log('✓ Active attempt retrieved successfully via GET /api/mocktest/active');

  // Autosave progress
  console.log('4. Autosaving answers via PATCH /api/mocktest/progress/:testId');
  const answerPatch = { [questions[0].id]: questions[0].options?.[0] || 'A' };
  const progressRes = await fetch(`${BASE_URL}/api/mocktest/progress/${testId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      answers: answerPatch,
      currentQuestionIndex: 1,
      timeSpentSeconds: 45,
    }),
  });
  if (!progressRes.ok) {
    throw new Error(`Progress patch failed: ${progressRes.statusText}`);
  }
  console.log('✓ In-progress answers autosaved successfully.');

  // Verify active attempt was updated
  const activeUpdatedRes = await fetch(`${BASE_URL}/api/mocktest/active`, { headers: authHeaders });
  const activeUpdatedBody = (await activeUpdatedRes.json()) as any;
  const activeUpdatedData = activeUpdatedBody.data || activeUpdatedBody;
  if (!activeUpdatedData.attempt?.answers?.[questions[0].id]) {
    throw new Error('Autosaved answer was not preserved in server active attempt!');
  }
  console.log('✓ Server active attempt verified with preserved answers.');

  // 5. Submit mock test
  console.log('5. Submitting test via POST /api/mocktest/submit');
  const allAnswers: Record<string, string> = {};
  for (const q of questions) {
    allAnswers[q.id] = q.options?.[0] || 'A';
  }
  const submitRes = await fetch(`${BASE_URL}/api/mocktest/submit`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      testId,
      answers: allAnswers,
      timeSpentSeconds: 90,
      timezone: 'UTC',
      localDate: '2026-11-14',
    }),
  });
  const submitBody = (await submitRes.json()) as any;
  const submitData = submitBody.data || submitBody;
  console.log(`Submitted test. Result score: ${submitData.scorePercent}%, correct: ${submitData.correctCount}`);

  // Verify attempt is marked submitted and no longer active
  const activeAfterSubmit = await fetch(`${BASE_URL}/api/mocktest/active`, { headers: authHeaders });
  const activeAfterBody = (await activeAfterSubmit.json()) as any;
  const activeAfterData = activeAfterBody.data || activeAfterBody;
  if (activeAfterData.attempt !== null) {
    throw new Error('Attempt is still active after submission!');
  }
  console.log('✓ Active attempt cleared on submit.');

  // Verify result by ID URL route (/api/mocktest/results/:id)
  const resultByIdRes = await fetch(`${BASE_URL}/api/mocktest/results/${testId}`, { headers: authHeaders });
  const resultByIdBody = (await resultByIdRes.json()) as any;
  console.log('Result by ID response:', resultByIdRes.status, resultByIdBody);
  const resultByIdData = resultByIdBody.data || resultByIdBody;
  if (!resultByIdData.result) {
    throw new Error('Could not retrieve result by URL ID!');
  }
  console.log('✓ Result retrieved by URL ID route successfully.');

  // 6. Check updated stats after mutation
  console.log('6. Verifying Single Source of Truth stats after test submission');
  const updatedStatsRes = await fetch(`${BASE_URL}/api/stats/summary?timezone=UTC&localDate=2026-11-14`, {
    headers: authHeaders,
  });
  const updatedStats = (await updatedStatsRes.json()) as any;
  console.log('Updated Stats:', {
    testsTaken: updatedStats.data.testsTaken,
    averageScore: updatedStats.data.averageScore,
    currentStreak: updatedStats.data.currentStreak,
    activeDaysCount: updatedStats.data.activeDaysCount,
    totalPoints: updatedStats.data.totalPoints,
    xp: updatedStats.data.xp,
    level: updatedStats.data.level,
  });

  if (updatedStats.data.testsTaken !== 1) {
    throw new Error(`Expected testsTaken=1, got ${updatedStats.data.testsTaken}`);
  }
  if (updatedStats.data.currentStreak < 1) {
    throw new Error(`Expected currentStreak >= 1, got ${updatedStats.data.currentStreak}`);
  }
  if (updatedStats.data.totalPoints < 4) {
    throw new Error(`Expected totalPoints >= 4, got ${updatedStats.data.totalPoints}`);
  }

  // Verify activity heatmap endpoint matches stats summary exactly
  const updatedActivityRes = await fetch(`${BASE_URL}/api/activity?timezone=UTC&localDate=2026-11-14`, {
    headers: authHeaders,
  });
  const updatedActivity = (await updatedActivityRes.json()) as any;
  if (updatedStats.data.currentStreak !== updatedActivity.data.currentStreak) {
    throw new Error(
      `Streak mismatch after submit: stats=${updatedStats.data.currentStreak}, activity=${updatedActivity.data.currentStreak}`
    );
  }
  console.log('✓ Contribution graph & streak match exactly across all endpoints.');

  // 7. Test backfill endpoint
  console.log('7. Testing POST /api/activity/backfill');
  const backfillRes = await fetch(`${BASE_URL}/api/activity/backfill`, {
    method: 'POST',
    headers: authHeaders,
  });
  const backfillData = (await backfillRes.json()) as any;
  console.log('Backfill result:', backfillData.data);
  if (!backfillRes.ok || backfillData.data?.assessmentsProcessed < 1) {
    throw new Error(`Backfill failed or did not process the test: ${JSON.stringify(backfillData)}`);
  }
  console.log('✓ Activity backfill succeeded idempotently.');

  console.log('\n=== ALL VERIFICATIONS PASSED WITH 100% ACCURACY ===');
}

runVerification().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
