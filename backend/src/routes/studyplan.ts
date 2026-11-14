import { Router } from 'express';
import {
  generateStudyPlanSessions,
  generateSessionAssessment,
  evaluateSessionUnderstanding,
  GeminiError,
} from '../lib/gemini.js';
import { goalStore } from '../lib/goals.js';
import { planStore, sessionStore, type StoredStudySession } from '../lib/studyPlans.js';
import { assessmentStore } from '../lib/assessments.js';
import { activityStore } from '../lib/activityStore.js';
import { computeProgressForUser } from '../lib/progressCompute.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { emitToUser } from '../lib/socket.js';
import { getDb } from '../lib/db.js';
import { generateStageTest, evaluateStudentAnswer, type PlannerTestAttempt } from '../lib/plannerTests.js';
import { badgesStore } from '../lib/achievements.js';
import { resolveEffectiveTimezone, getDateKeyForTimezone } from '../lib/timezone.js';
import { userStore } from '../lib/users.js';

export const studyPlanRouter = Router();

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function recomputeCompletion(sessions: StoredStudySession[]): number {
  if (sessions.length === 0) return 0;
  const totalConcepts = sessions.reduce((sum, s) => sum + s.conceptsTotal, 0);
  const doneConcepts = sessions.reduce((sum, s) => sum + s.conceptsDone, 0);
  if (totalConcepts === 0) return 0;
  return Math.round((doneConcepts / totalConcepts) * 100);
}

function scheduleDates(
  sessions: {
    topic: string;
    subject: string;
    objective: string;
    estimatedMinutes: number;
    difficulty: 'easy' | 'medium' | 'hard';
    conceptsTotal: number;
  }[],
  studyDays: string[],
  startDayNumber: number,
  startFrom: Date,
): Omit<StoredStudySession, 'id' | 'planId' | 'userId'>[] {
  const cursor = new Date(startFrom);
  return sessions.map((s, i) => {
    while (studyDays.length > 0 && !studyDays.includes(DAY_SHORT_NAMES[cursor.getDay()])) {
      cursor.setDate(cursor.getDate() + 1);
    }
    const date = cursor.toISOString();
    cursor.setDate(cursor.getDate() + 1);
    return {
      day: startDayNumber + i,
      date,
      topic: s.topic,
      subject: s.subject,
      objective: s.objective,
      estimatedMinutes: s.estimatedMinutes,
      difficulty: s.difficulty,
      status: (i === 0 ? 'upcoming' : 'locked') as StoredStudySession['status'],
      conceptsTotal: s.conceptsTotal,
      conceptsDone: 0,
    };
  });
}

studyPlanRouter.post('/generate', requireAuth, async (req: AuthedRequest, res) => {
  const goal = await goalStore.getActive(req.userId!);
  if (!goal) {
    res.status(400).json({ error: { message: 'Create a learning goal first.' } });
    return;
  }

  const daysUntilDeadline = Math.max(
    1,
    Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );
  const numSessions = Math.min(Math.max(daysUntilDeadline, 3), 14);
  const { weakTopics } = await computeProgressForUser(req.userId!);

  try {
    const generated = await generateStudyPlanSessions({
      goalTitle: goal.title,
      subjects: goal.subjects,
      topics: goal.topics,
      deadline: goal.deadline,
      hoursPerDay: goal.availableTime.hoursPerDay,
      preferredTime: goal.availableTime.preferredTime,
      knowledgeLevel: goal.knowledgeLevel,
      weakTopics,
      numSessions,
    });

    const totalStudyHours = Math.round((generated.reduce((sum, s) => sum + s.estimatedMinutes, 0) / 60) * 10) / 10;
    const plan = await planStore.create({
      userId: req.userId!,
      goalId: goal.id,
      goalTitle: goal.title,
      examDate: goal.deadline,
      totalStudyHours,
      completionPercent: 0,
      lastAdaptedAt: null,
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const scheduled = scheduleDates(generated, goal.availableTime.studyDays, 1, tomorrow);
    const sessions = await sessionStore.insertMany(
      scheduled.map((s) => ({ ...s, planId: plan.id, userId: req.userId! })),
    );

    res.json({ data: { plan, sessions } });
  } catch (err) {
    if (err instanceof GeminiError) {
      res.status(502).json({ error: { message: err.message } });
      return;
    }
    console.error('Study plan generation failed:', err);
    res.status(500).json({ error: { message: 'Something went wrong generating your study plan. Please try again.' } });
  }
});

studyPlanRouter.get('/current', requireAuth, async (req: AuthedRequest, res) => {
  const plan = await planStore.getActive(req.userId!);
  const sessions = plan ? await sessionStore.listByPlan(plan.id) : [];
  res.json({ data: { plan: plan ?? null, sessions } });
});

// START STAGE VERIFICATION TEST
studyPlanRouter.post('/sessions/:id/test/start', requireAuth, async (req: AuthedRequest, res) => {
  const session = await sessionStore.findById(req.params.id);
  if (!session || session.userId !== req.userId) {
    res.status(404).json({ error: { message: 'Session not found.' } });
    return;
  }

  const db = await getDb();

  // Enforce progression: previous day must be passed/completed before taking this test
  if (session.day > 1) {
    const prevSession = await db.collection<StoredStudySession>('study_sessions').findOne({
      planId: session.planId,
      day: session.day - 1,
    });
    if (prevSession && prevSession.status !== 'completed') {
      res.status(403).json({ error: { message: `Please complete and pass Day ${session.day - 1} before attempting Day ${session.day}.` } });
      return;
    }
  }

  // Cooldown enforcement: 2 minutes cooldown after a failed attempt
  const recentAttempt = await db
    .collection<PlannerTestAttempt>('planner_test_attempts')
    .find({ userId: req.userId!, sessionId: session.id })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  if (recentAttempt.length > 0 && recentAttempt[0].status === 'failed') {
    const elapsedMs = Date.now() - new Date(recentAttempt[0].createdAt).getTime();
    const cooldownMs = 120 * 1000; // 2 minutes cooldown
    if (elapsedMs < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
      res.status(429).json({
        error: {
          message: `Cooldown active. Please review your mistakes and wait ${remainingSec}s before retrying.`,
          secondsRemaining: remainingSec,
        },
      });
      return;
    }
  }

  const { weakTopics } = await computeProgressForUser(req.userId!);
  const attemptsCount = (session as any).attemptsCount || 0;

  try {
    const questions = await generateStageTest({
      topic: session.topic,
      subject: session.subject,
      objective: session.objective,
      difficulty: session.difficulty,
      weakTopics,
      attemptNumber: attemptsCount + 1,
    });

    const attemptId = `stage_att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const attemptDoc: PlannerTestAttempt = {
      id: attemptId,
      userId: req.userId!,
      sessionId: session.id,
      planId: session.planId,
      day: session.day,
      attemptNumber: attemptsCount + 1,
      questions,
      status: 'in-progress',
      createdAt: new Date().toISOString(),
    };

    await db.collection('planner_test_attempts').insertOne(attemptDoc);

    // Strip answers and explanations before sending to student
    const studentQuestions = questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      topic: q.topic,
      isCoding: q.isCoding,
      language: q.language,
      starterCode: q.starterCode,
      reviewMode: q.reviewMode,
      testCases: q.testCases?.map((tc) => ({ input: tc.input, expected: tc.expected, description: tc.description })),
    }));

    res.json({
      data: {
        attemptId,
        sessionId: session.id,
        day: session.day,
        topic: session.topic,
        subject: session.subject,
        passMark: 90,
        questions: studentQuestions,
        attemptsCount,
        bestScore: (session as any).bestScore || 0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start test';
    res.status(500).json({ error: { message } });
  }
});

// SUBMIT STAGE VERIFICATION TEST
studyPlanRouter.post('/sessions/:id/test/submit', requireAuth, async (req: AuthedRequest, res) => {
  const { attemptId, answers, codeResults, timezone, localDate } = req.body || {};
  if (!attemptId || typeof attemptId !== 'string') {
    res.status(400).json({ error: { message: 'attemptId is required.' } });
    return;
  }

  const session = await sessionStore.findById(req.params.id);
  if (!session || session.userId !== req.userId) {
    res.status(404).json({ error: { message: 'Session not found.' } });
    return;
  }

  const db = await getDb();
  const attempt = await db.collection<PlannerTestAttempt>('planner_test_attempts').findOne({
    id: attemptId,
    userId: req.userId!,
    sessionId: session.id,
  });

  if (!attempt) {
    res.status(404).json({ error: { message: 'Attempt record not found.' } });
    return;
  }

  const userAnswers: Record<string, string> = typeof answers === 'object' && answers ? answers : {};
  const codeResMap: Record<string, { passed: boolean }> = typeof codeResults === 'object' && codeResults ? codeResults : {};

  let earned = 0;
  const mistakes: Array<{
    questionId: string;
    prompt: string;
    studentAnswer: string;
    correctAnswer: string;
    explanation: string;
  }> = [];

  for (const q of attempt.questions) {
    const studentAns = userAnswers[q.id] || '';
    const codeRes = codeResMap[q.id];
    const evaluation = evaluateStudentAnswer(q, studentAns, codeRes);

    if (evaluation.isCorrect) {
      earned += 1;
    } else {
      mistakes.push({
        questionId: q.id,
        prompt: q.prompt,
        studentAnswer: evaluation.studentAnswer,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      });
    }
  }

  const total = attempt.questions.length || 1;
  const scorePercent = Math.round((earned / total) * 100);
  const passed = scorePercent >= 90;

  // Resolve user timezone & dateKey
  const user = await userStore.findById(req.userId!);
  const tzResolution = resolveEffectiveTimezone(timezone, user?.timezone);
  const effectiveTz = tzResolution.timezone || 'Asia/Kolkata';
  const dateKey =
    typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : getDateKeyForTimezone(new Date(), effectiveTz);

  // Update attempt record
  await db.collection('planner_test_attempts').updateOne(
    { id: attemptId },
    {
      $set: {
        status: passed ? 'passed' : 'failed',
        scorePercent,
        passed,
        mistakes,
        completedAt: new Date().toISOString(),
      },
    }
  );

  const prevAttempts = (session as any).attemptsCount || 0;
  const newAttemptsCount = prevAttempts + 1;
  const prevBest = (session as any).bestScore || 0;
  const newBestScore = Math.max(prevBest, scorePercent);

  let updatedSession: StoredStudySession | undefined;
  let updatedPlan = await planStore.findById(session.planId);

  if (passed) {
    // 1. Mark current session completed
    updatedSession = await sessionStore.update(session.id, {
      status: 'completed',
      conceptsDone: session.conceptsTotal,
      completedAt: new Date().toISOString(),
      attemptsCount: newAttemptsCount,
      bestScore: newBestScore,
      lastTestStatus: 'passed',
      lastAttemptAt: new Date().toISOString(),
    } as any);

    // 2. Unlock the very next session in this plan
    const nextSession = await db.collection<StoredStudySession>('study_sessions').findOne({
      planId: session.planId,
      day: session.day + 1,
    });
    if (nextSession && nextSession.status === 'locked') {
      await sessionStore.update(nextSession.id, { status: 'upcoming' });
    }

    // 3. Recompute plan completion
    const allSessions = await sessionStore.listByPlan(session.planId);
    updatedPlan = await planStore.update(session.planId, { completionPercent: recomputeCompletion(allSessions) });

    // 4. Record genuine activity event (3 points for passed session)
    await activityStore.recordActivity(
      req.userId!,
      'session',
      dateKey,
      3,
      {
        title: `Passed Day ${session.day} Test: ${session.topic} (${scorePercent}%)`,
        sessionId: session.id,
        planId: session.planId,
        scorePercent,
      },
      `session:${session.id}`
    );

    // 5. Evaluate badge achievements (e.g. first_planner_stage_passed, score_90_plus)
    await badgesStore.evaluateBadgesForUser(req.userId!);

    emitToUser(req.userId!, 'stats:invalidate', { reason: 'session_test_passed', sessionId: session.id });
  } else {
    // Failed attempt: save attempt count and best score, session remains in-progress
    updatedSession = await sessionStore.update(session.id, {
      attemptsCount: newAttemptsCount,
      bestScore: newBestScore,
      lastTestStatus: 'failed',
      lastAttemptAt: new Date().toISOString(),
    } as any);
  }

  res.json({
    data: {
      passed,
      scorePercent,
      passMark: 90,
      mistakes,
      attemptsCount: newAttemptsCount,
      bestScore: newBestScore,
      nextUnlocked: passed,
      session: updatedSession,
      plan: updatedPlan,
    },
  });
});

// SERVER-ENFORCED COMPLETION: Refuses completion unless a passed attempt exists
studyPlanRouter.post('/sessions/:id/complete', requireAuth, async (req: AuthedRequest, res) => {
  const session = await sessionStore.findById(req.params.id);
  if (!session || session.userId !== req.userId) {
    res.status(404).json({ error: { message: 'Session not found.' } });
    return;
  }

  const db = await getDb();
  const passedAttempt = await db.collection('planner_test_attempts').findOne({
    userId: req.userId!,
    sessionId: session.id,
    passed: true,
  });

  if (!passedAttempt) {
    res.status(403).json({
      error: { message: 'Verification required: You must pass the day test with at least 90% before marking this day complete.' },
    });
    return;
  }

  const updated = await sessionStore.update(session.id, {
    status: 'completed',
    conceptsDone: session.conceptsTotal,
    completedAt: new Date().toISOString(),
  });
  const allSessions = await sessionStore.listByPlan(session.planId);
  const plan = await planStore.update(session.planId, { completionPercent: recomputeCompletion(allSessions) });

  // ATOMIC WRITE: Record activity event in the same completion handler
  const { timezone, localDate } = req.body ?? {};
  let dateKey = typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : '';
  if (!dateKey) {
    try {
      const tz = typeof timezone === 'string' && timezone ? timezone : 'UTC';
      dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    } catch {
      dateKey = new Date().toISOString().slice(0, 10);
    }
  }

  await activityStore.recordActivity(
    req.userId!,
    'session',
    dateKey,
    3,
    { title: `Completed Session: ${session.topic}`, sessionId: session.id, planId: session.planId },
    `session:${session.id}`
  );

  emitToUser(req.userId!, 'stats:invalidate', { reason: 'session_completed', sessionId: session.id });

  res.json({ data: { session: updated, plan } });
});

studyPlanRouter.post('/sessions/:id/reschedule', requireAuth, async (req: AuthedRequest, res) => {
  const { newDate } = req.body ?? {};
  if (!newDate || typeof newDate !== 'string' || Number.isNaN(new Date(newDate).getTime())) {
    res.status(400).json({ error: { message: 'A valid newDate is required.' } });
    return;
  }
  const session = await sessionStore.findById(req.params.id);
  if (!session || session.userId !== req.userId) {
    res.status(404).json({ error: { message: 'Session not found.' } });
    return;
  }
  const updated = await sessionStore.update(session.id, { date: newDate, status: 'upcoming' });
  res.json({ data: { session: updated } });
});

studyPlanRouter.post('/replan', requireAuth, async (req: AuthedRequest, res) => {
  const goal = await goalStore.getActive(req.userId!);
  const plan = await planStore.getActive(req.userId!);
  if (!goal || !plan) {
    res.status(400).json({ error: { message: 'No active study plan to replan.' } });
    return;
  }

  const now = new Date();
  const allSessions = await sessionStore.listByPlan(plan.id);
  const completed = allSessions.filter((s) => s.status === 'completed');
  const incomplete = allSessions.filter((s) => s.status !== 'completed');
  const missedTopics = incomplete.filter((s) => s.status === 'missed' || new Date(s.date) < now).map((s) => s.topic);
  const remainingTopics = Array.from(new Set(incomplete.map((s) => s.topic)));

  const daysUntilExam = Math.max(
    1,
    Math.ceil((new Date(plan.examDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const numSessions = Math.min(Math.max(daysUntilExam, 2), 14);
  const { weakTopics } = await computeProgressForUser(req.userId!);

  try {
    const generated = await generateStudyPlanSessions({
      goalTitle: goal.title,
      subjects: goal.subjects,
      topics: remainingTopics.length > 0 ? remainingTopics : goal.topics,
      deadline: plan.examDate,
      hoursPerDay: goal.availableTime.hoursPerDay,
      preferredTime: goal.availableTime.preferredTime,
      knowledgeLevel: goal.knowledgeLevel,
      weakTopics: Array.from(new Set([...missedTopics, ...weakTopics])),
      numSessions,
    });

    await sessionStore.deleteMany(incomplete.map((s) => s.id));
    const startDay = completed.length > 0 ? Math.max(...completed.map((s) => s.day)) + 1 : 1;
    const scheduled = scheduleDates(generated, goal.availableTime.studyDays, startDay, now);
    const newSessions = await sessionStore.insertMany(
      scheduled.map((s) => ({ ...s, planId: plan.id, userId: req.userId! })),
    );

    const finalSessions = [...completed, ...newSessions].sort((a, b) => a.day - b.day);
    const updatedPlan = await planStore.update(plan.id, {
      completionPercent: recomputeCompletion(finalSessions),
      lastAdaptedAt: now.toISOString(),
    });

    res.json({ data: { plan: updatedPlan, sessions: finalSessions } });
  } catch (err) {
    if (err instanceof GeminiError) {
      res.status(502).json({ error: { message: err.message } });
      return;
    }
    console.error('Replan failed:', err);
    res.status(500).json({ error: { message: 'Something went wrong adjusting your plan. Please try again.' } });
  }
});

studyPlanRouter.post('/session-assessment', requireAuth, async (req, res) => {
  const { topic, subject, objective, difficulty, supplementaryMaterial } = req.body ?? {};

  if (
    !topic ||
    typeof topic !== 'string' ||
    !subject ||
    typeof subject !== 'string' ||
    !objective ||
    typeof objective !== 'string'
  ) {
    res.status(400).json({ error: { message: 'topic, subject, and objective are required.' } });
    return;
  }
  const diff = DIFFICULTIES.includes(difficulty) ? difficulty : 'medium';

  try {
    const questions = await generateSessionAssessment({
      topic,
      subject,
      objective,
      difficulty: diff,
      supplementaryMaterial: typeof supplementaryMaterial === 'string' ? supplementaryMaterial : undefined,
    });
    res.json({ data: { questions } });
  } catch (err) {
    if (err instanceof GeminiError) {
      res.status(502).json({ error: { message: err.message } });
      return;
    }
    console.error('Session assessment generation failed:', err);
    res
      .status(500)
      .json({ error: { message: 'Something went wrong generating your knowledge check. Please try again.' } });
  }
});

studyPlanRouter.post('/session-evaluate', requireAuth, async (req: AuthedRequest, res) => {
  const { sessionId, qa } = req.body ?? {};

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: { message: 'sessionId is required.' } });
    return;
  }
  if (!Array.isArray(qa) || qa.length === 0) {
    res.status(400).json({ error: { message: 'qa answers are required.' } });
    return;
  }
  const session = await sessionStore.findById(sessionId);
  if (!session || session.userId !== req.userId) {
    res.status(404).json({ error: { message: 'Session not found.' } });
    return;
  }

  const safeQa = qa
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
      correctAnswer: typeof item.correctAnswer === 'string' ? item.correctAnswer : '',
      studentAnswer: typeof item.studentAnswer === 'string' ? item.studentAnswer : '',
      topic: typeof item.topic === 'string' ? item.topic : 'General',
    }));

  try {
    const evaluation = await evaluateSessionUnderstanding({
      topic: session.topic,
      subject: session.subject,
      objective: session.objective,
      qa: safeQa,
    });

    await assessmentStore.create({
      userId: req.userId!,
      kind: 'session-check',
      subject: session.subject,
      topic: session.topic,
      understood: evaluation.understood,
      masteryLevel: evaluation.masteryLevel,
      weakAreas: evaluation.weakConcepts,
    });

    let updatedSession: StoredStudySession | undefined;
    let updatedPlan = await planStore.findById(session.planId);

    if (evaluation.understood) {
      updatedSession = await sessionStore.update(session.id, {
        status: 'completed',
        conceptsDone: session.conceptsTotal,
        completedAt: new Date().toISOString(),
      });
      const allSessions = await sessionStore.listByPlan(session.planId);
      updatedPlan = await planStore.update(session.planId, { completionPercent: recomputeCompletion(allSessions) });
    } else {
      const newDate = new Date(Date.now() + Math.max(evaluation.recommendedRescheduleDays, 1) * 24 * 60 * 60 * 1000);
      updatedSession = await sessionStore.update(session.id, { date: newDate.toISOString(), status: 'upcoming' });
    }

    res.json({ data: { evaluation, session: updatedSession, plan: updatedPlan } });
  } catch (err) {
    if (err instanceof GeminiError) {
      res.status(502).json({ error: { message: err.message } });
      return;
    }
    console.error('Session evaluation failed:', err);
    res
      .status(500)
      .json({ error: { message: 'Something went wrong evaluating your understanding. Please try again.' } });
  }
});
