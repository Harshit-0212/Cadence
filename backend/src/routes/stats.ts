import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { getDb } from '../lib/db.js';
import { activityStore } from '../lib/activityStore.js';

export const statsRouter = Router();
statsRouter.use(requireAuth);

export interface StatsSummary {
  // Streaks & Activity
  currentStreak: number;
  longestStreak: number;
  activeDaysCount: number;
  distinctDays: string[];
  totalPoints: number;

  // Assessments & Quizzes
  testsTaken: number;
  averageScore: number;
  bestScore: number;
  lastTestScore: number | null;

  // Study Sessions & Focus
  studyMinutes: number;
  sessionsCompleted: number;

  // Flashcards & Spaced Repetition
  flashcardsTotal: number;
  flashcardsDue: number;
  flashcardsMastered: number;
  flashcardsLearning: number;

  // Mistakes
  mistakesTotal: number;
  mistakesUnresolved: number;

  // Interviews
  interviewsTaken: number;
  interviewAverageScore: number;

  // Coding Challenges
  codingSubmissionsCount: number;
  codingAcceptedCount: number;

  // Gamification Metrics (strictly derived, never hard-coded)
  xp: number;
  level: number;
  rank: string;
}

export async function computeUserStatsSummary(userId: string, timezone?: string, localDate?: string): Promise<StatsSummary> {
  const db = await getDb();

  // Resolve user local date from timezone
  let userToday = typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : '';
  if (!userToday) {
    try {
      const tz = typeof timezone === 'string' && timezone ? timezone : 'UTC';
      userToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    } catch {
      userToday = new Date().toISOString().slice(0, 10);
    }
  }

  // 1. Streak and distinct days directly from activity_events (single source of truth)
  const streakInfo = await activityStore.computeStreak(userId, userToday);

  // 2. Activity events aggregation (total points, active days)
  const activityEvents = await db.collection('activity_events').find({ userId }).toArray();
  const totalPoints = activityEvents.reduce((acc, ev) => acc + (Number(ev.points) || 0), 0);
  const activeDaysCount = streakInfo.distinctDays.length;

  // 3. Assessment results (tests taken, scores)
  const assessments = await db.collection('assessment_results').find({ userId }).toArray();
  const scoredTests = assessments.filter((a) => typeof a.scorePercent === 'number');
  const testsTaken = scoredTests.length;
  let averageScore = 0;
  let bestScore = 0;
  let lastTestScore: number | null = null;

  if (testsTaken > 0) {
    const scores = scoredTests.map((t) => Number(t.scorePercent) || 0);
    averageScore = Math.round(scores.reduce((sum, s) => sum + s, 0) / testsTaken);
    bestScore = Math.max(...scores);
    // Sort by takenAt descending to get the last test score
    const sortedTests = [...scoredTests].sort(
      (a, b) => new Date(b.takenAt || 0).getTime() - new Date(a.takenAt || 0).getTime()
    );
    lastTestScore = sortedTests[0].scorePercent;
  }

  // 4. Study sessions & Focus minutes
  const studySessions = await db.collection('study_sessions').find({ userId }).toArray();
  const completedSessions = studySessions.filter((s) => s.status === 'completed');
  const sessionsCompleted = completedSessions.length;
  const sessionStudyMinutes = completedSessions.reduce(
    (sum, s) => sum + (Number(s.estimatedMinutes) || Number(s.durationMinutes) || 0),
    0
  );

  // Focus sessions points from activity_events (each focus event has points = Math.round(duration / 25), approx 25m per point)
  const focusEvents = activityEvents.filter((ev) => ev.type === 'focus' || ev.type === 'focus_minutes');
  const focusMinutes = focusEvents.reduce((sum, ev) => {
    const duration =
      (ev.meta?.durationMinutes as number) ||
      (ev.meta?.minutes as number) ||
      (ev.points ? ev.points * 25 : 25);
    return sum + duration;
  }, 0);
  const studyMinutes = sessionStudyMinutes + focusMinutes;

  // 5. Flashcards (due, mastered, learning)
  const nowIso = new Date().toISOString();
  const flashcards = await db.collection('flashcards').find({ userId }).toArray();
  const flashcardsTotal = flashcards.length;
  const flashcardsDue = flashcards.filter((f) => !f.nextReviewDate || f.nextReviewDate <= nowIso).length;
  const flashcardsMastered = flashcards.filter(
    (f) => f.stage === 'mastered' || (typeof f.interval === 'number' && f.interval >= 21)
  ).length;
  const flashcardsLearning = flashcardsTotal - flashcardsMastered;

  // 6. Mistakes
  const mistakes = await db.collection('mistakes').find({ userId }).toArray();
  const mistakesTotal = mistakes.length;
  const mistakesUnresolved = mistakes.filter((m) => !m.resolved).length;

  // 7. Interviews
  const interviews = await db.collection('interview_reports').find({ userId }).toArray();
  const interviewsTaken = interviews.length;
  const interviewAverageScore =
    interviewsTaken > 0
      ? Math.round(interviews.reduce((sum, i) => sum + (Number(i.overallScore) || 0), 0) / interviewsTaken)
      : 0;

  // 8. Coding submissions
  const codingSubmissions = await db.collection('coding_submissions').find({ userId }).toArray();
  const codingSubmissionsCount = codingSubmissions.length;
  const codingAcceptedCount = codingSubmissions.filter(
    (s) => s.status === 'accepted' || s.verdict === 'Accepted'
  ).length;

  // 9. Derived XP & Level
  // XP formula: 100 XP per test taken, 50 XP per study session, 20 XP per active day streak, 15 XP per point from events
  const xp =
    testsTaken * 100 +
    sessionsCompleted * 50 +
    codingAcceptedCount * 80 +
    flashcardsMastered * 15 +
    totalPoints * 10;

  const level = Math.floor(xp / 500) + 1;

  let rank = 'Novice';
  if (level >= 10) rank = 'Master';
  else if (level >= 7) rank = 'Expert';
  else if (level >= 5) rank = 'Proficient';
  else if (level >= 3) rank = 'Apprentice';

  return {
    currentStreak: streakInfo.currentStreak,
    longestStreak: streakInfo.longestStreak,
    activeDaysCount,
    distinctDays: streakInfo.distinctDays,
    totalPoints,

    testsTaken,
    averageScore,
    bestScore,
    lastTestScore,

    studyMinutes,
    sessionsCompleted,

    flashcardsTotal,
    flashcardsDue,
    flashcardsMastered,
    flashcardsLearning,

    mistakesTotal,
    mistakesUnresolved,

    interviewsTaken,
    interviewAverageScore,

    codingSubmissionsCount,
    codingAcceptedCount,

    xp,
    level,
    rank,
  };
}

/**
 * GET /api/stats/summary
 * Single Source of Truth for all platform metrics.
 */
statsRouter.get('/summary', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { timezone, localDate } = req.query;

  try {
    const summary = await computeUserStatsSummary(
      userId,
      typeof timezone === 'string' ? timezone : undefined,
      typeof localDate === 'string' ? localDate : undefined
    );
    res.json({ data: summary });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to compute stats';
    res.status(500).json({ error: { message: msg } });
  }
});

