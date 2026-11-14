import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { activityStore, type ActivityEventType } from '../lib/activityStore.js';
import { backfillUserActivity } from '../lib/activityBackfill.js';
import { emitToUser } from '../lib/socket.js';
import { resolveEffectiveTimezone, getDateKeyForTimezone } from '../lib/timezone.js';
import { userStore } from '../lib/users.js';

export const activityRouter = Router();
activityRouter.use(requireAuth);

/**
 * POST /api/activity/checkin
 * Checks in for the current user's day, registering an idempotent 'app_open' event.
 * Expects { timezone?: string, localDate?: string }
 */
activityRouter.post('/checkin', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { timezone, localDate } = req.body || {};

  const user = await userStore.findById(userId);
  const tzResolution = resolveEffectiveTimezone(timezone, user?.timezone);
  if (tzResolution.error) {
    res.status(400).json({ error: { message: tzResolution.error } });
    return;
  }
  const effectiveTz = tzResolution.timezone;
  if (effectiveTz !== user?.timezone) {
    userStore.updateTimezone(userId, effectiveTz).catch(() => {});
  }

  // Resolve user local date from timezone using shared helper
  const dateKey =
    typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : getDateKeyForTimezone(new Date(), effectiveTz);

  // Record app_open (1 point, idempotent per day)
  await activityStore.recordActivity(userId, 'app_open', dateKey, 1, { timezone: effectiveTz }, `app_open:${dateKey}`);

  emitToUser(userId, 'stats:invalidate', { reason: 'checkin' });

  const streak = await activityStore.computeStreak(userId, dateKey);
  res.json({
    data: {
      success: true,
      dateKey,
      timezone: effectiveTz,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    },
  });
});

/**
 * POST /api/activity/record
 * Logs any activity (focus, session, mock_test, etc.)
 */
activityRouter.post('/record', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { type, points, meta, localDate, timezone, eventKey } = req.body || {};

  const validTypes: ActivityEventType[] = [
    'session',
    'mock_test',
    'interview',
    'flashcard',
    'mistake_retry',
    'tutor',
    'focus',
    'focus_minutes',
    'document',
    'app_open',
    'coding_submission',
  ];

  if (!type || !validTypes.includes(type)) {
    res.status(400).json({ error: { message: 'Invalid activity type.' } });
    return;
  }

  const user = await userStore.findById(userId);
  const tzResolution = resolveEffectiveTimezone(timezone, user?.timezone);
  if (tzResolution.error) {
    res.status(400).json({ error: { message: tzResolution.error } });
    return;
  }
  const effectiveTz = tzResolution.timezone;

  const dateKey =
    typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : getDateKeyForTimezone(new Date(), effectiveTz);

  const defaultPoints: Record<ActivityEventType, number> = {
    session: 3,
    mock_test: 4,
    interview: 4,
    flashcard: 1,
    mistake_retry: 1,
    tutor: 1,
    focus: 1,
    focus_minutes: 1,
    document: 1,
    app_open: 1,
    coding_submission: 3,
  };

  const finalPoints = typeof points === 'number' && points >= 0 ? points : defaultPoints[type as ActivityEventType];

  const recorded = await activityStore.recordActivity(userId, type, dateKey, finalPoints, meta, eventKey);
  emitToUser(userId, 'stats:invalidate', { reason: type });
  const streak = await activityStore.computeStreak(userId, dateKey);

  res.json({
    data: {
      recorded,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    },
  });
});

/**
 * POST /api/activity/focus
 * Idempotently records a focus session activity event (type 'focus_minutes').
 * Uses sessionId as eventKey.
 */
activityRouter.post('/focus', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { sessionId, durationMinutes, localDate, timezone } = req.body || {};

  if (!sessionId) {
    res.status(400).json({ error: { message: 'sessionId is required.' } });
    return;
  }

  const user = await userStore.findById(userId);
  const tzResolution = resolveEffectiveTimezone(timezone, user?.timezone);
  if (tzResolution.error) {
    res.status(400).json({ error: { message: tzResolution.error } });
    return;
  }
  const effectiveTz = tzResolution.timezone;

  const minutes = typeof durationMinutes === 'number' && durationMinutes > 0 ? Math.round(durationMinutes) : 25;
  const points = Math.max(1, Math.round(minutes / 25));

  const dateKey =
    typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : getDateKeyForTimezone(new Date(), effectiveTz);

  const recorded = await activityStore.recordActivity(
    userId,
    'focus_minutes',
    dateKey,
    points,
    {
      sessionId,
      durationMinutes: minutes,
      minutes,
      title: `Focus Session (${minutes}m)`,
    },
    `focus:${sessionId}`
  );

  emitToUser(userId, 'stats:invalidate', { reason: 'focus_completed', sessionId });
  const streak = await activityStore.computeStreak(userId, dateKey);

  res.json({
    data: {
      recorded,
      sessionId,
      minutes,
      points,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    },
  });
});

/**
 * GET /api/activity
 * Returns heatmaps, stats, streak, and daily breakdown.
 */
activityRouter.get('/', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { year, month, type, timezone, localDate } = req.query;

  const user = await userStore.findById(userId);
  const tzResolution = resolveEffectiveTimezone(timezone as string, user?.timezone);
  if (tzResolution.error) {
    res.status(400).json({ error: { message: tzResolution.error } });
    return;
  }
  const effectiveTz = tzResolution.timezone;

  const userToday =
    typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)
      ? localDate
      : getDateKeyForTimezone(new Date(), effectiveTz);

  const yearNum = year ? parseInt(year as string, 10) : new Date().getFullYear();
  const monthNum = month ? parseInt(month as string, 10) : undefined;
  const typeStr = typeof type === 'string' ? type : undefined;

  const data = await activityStore.getActivityData(userId, userToday, yearNum, monthNum, typeStr);
  res.json({ data });
});

/**
 * POST /api/activity/backfill
 * Rebuilds activity events from all historical assessments, sessions, interviews, etc.
 */
activityRouter.post('/backfill', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  try {
    const result = await backfillUserActivity(userId);
    emitToUser(userId, 'stats:invalidate', { reason: 'backfill' });
    res.json({ data: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Backfill failed';
    res.status(500).json({ error: { message: msg } });
  }
});


