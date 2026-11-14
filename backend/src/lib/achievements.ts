import { getDb } from './db.js';
import { activityStore } from './activityStore.js';
import { emitToUser } from './socket.js';

export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type BadgeCategory = 'assessments' | 'streak' | 'study' | 'coding' | 'interviews' | 'community';

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  threshold: number;
  xpReward: number;
  rarity: BadgeRarity;
  howToEarn: string;
}

export interface UserBadgeDoc {
  _id?: string;
  userId: string;
  badgeId: string;
  unlockedAt: string;
  progress: number;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: 'first_mock_test',
    name: 'First Mock Test',
    description: 'Completed your first assessment test',
    icon: 'target',
    category: 'assessments',
    threshold: 1,
    xpReward: 50,
    rarity: 'common',
    howToEarn: 'Take and submit any mock test or assessment.',
  },
  {
    id: 'score_90_plus',
    name: 'High Scorer',
    description: 'Achieved 90% or higher score on a test',
    icon: 'award',
    category: 'assessments',
    threshold: 90,
    xpReward: 100,
    rarity: 'rare',
    howToEarn: 'Score 90%+ on any mock test or stage quiz.',
  },
  {
    id: 'streak_3',
    name: '3-Day Consistency',
    description: 'Maintained a 3-day active study streak',
    icon: 'flame',
    category: 'streak',
    threshold: 3,
    xpReward: 50,
    rarity: 'common',
    howToEarn: 'Complete study activity 3 consecutive days.',
  },
  {
    id: 'streak_7',
    name: 'Week Warrior',
    description: 'Maintained a 7-day study streak',
    icon: 'flame',
    category: 'streak',
    threshold: 7,
    xpReward: 150,
    rarity: 'rare',
    howToEarn: 'Keep your study streak active for 7 days.',
  },
  {
    id: 'streak_30',
    name: 'Monthly Master',
    description: 'Maintained a 30-day study streak',
    icon: 'trophy',
    category: 'streak',
    threshold: 30,
    xpReward: 500,
    rarity: 'legendary',
    howToEarn: 'Reach an incredible 30-day streak.',
  },
  {
    id: 'flashcards_10_mastered',
    name: 'Memory Virtuoso',
    description: 'Mastered 10 active recall flashcards',
    icon: 'layers',
    category: 'study',
    threshold: 10,
    xpReward: 75,
    rarity: 'common',
    howToEarn: 'Review and master 10 flashcards via SM-2 recall.',
  },
  {
    id: 'first_planner_stage_passed',
    name: 'Stage Champion',
    description: 'Passed your first planner stage test with 90%+',
    icon: 'check',
    category: 'study',
    threshold: 1,
    xpReward: 100,
    rarity: 'rare',
    howToEarn: 'Pass any planner day verification test with at least 90%.',
  },
  {
    id: 'coding_first_solve',
    name: 'First Algorithm Solved',
    description: 'Submitted your first accepted coding solution',
    icon: 'code',
    category: 'coding',
    threshold: 1,
    xpReward: 50,
    rarity: 'common',
    howToEarn: 'Solve any coding problem with all test cases passing.',
  },
  {
    id: 'coding_5_solved',
    name: 'Code Craftsman',
    description: 'Solved 5 distinct coding problems',
    icon: 'code',
    category: 'coding',
    threshold: 5,
    xpReward: 200,
    rarity: 'rare',
    howToEarn: 'Solve 5 different coding problems.',
  },
  {
    id: 'interview_70_plus',
    name: 'Interview Ready',
    description: 'Scored 70% or higher in an AI technical interview',
    icon: 'brain',
    category: 'interviews',
    threshold: 70,
    xpReward: 150,
    rarity: 'rare',
    howToEarn: 'Complete a technical interview with score 70%+.',
  },
  {
    id: 'mistakes_10_resolved',
    name: 'Error Eliminator',
    description: 'Resolved 10 notebook mistakes',
    icon: 'check',
    category: 'study',
    threshold: 10,
    xpReward: 100,
    rarity: 'rare',
    howToEarn: 'Mark 10 mistakes resolved in your Mistake Notebook.',
  },
  {
    id: 'first_document_analyzed',
    name: 'Curator',
    description: 'Uploaded your first study document',
    icon: 'book',
    category: 'study',
    threshold: 1,
    xpReward: 50,
    rarity: 'common',
    howToEarn: 'Upload any document into the Document Library.',
  },
  {
    id: 'focus_5_hours',
    name: 'Deep Diver',
    description: 'Accumulated 5 hours (300 minutes) in focus sessions',
    icon: 'clock',
    category: 'study',
    threshold: 300,
    xpReward: 150,
    rarity: 'rare',
    howToEarn: 'Log 300 minutes of focused Pomodoro study time.',
  },
  {
    id: 'joined_study_group',
    name: 'Study Circle',
    description: 'Joined or created a collaborative study group',
    icon: 'users',
    category: 'community',
    threshold: 1,
    xpReward: 50,
    rarity: 'common',
    howToEarn: 'Join or create any study group.',
  },
];

export const badgesStore = {
  async ensureIndexes(): Promise<void> {
    const db = await getDb();
    const col = db.collection<UserBadgeDoc>('user_badges');
    await col.createIndex({ userId: 1, badgeId: 1 }, { unique: true }).catch(() => {});
    await col.createIndex({ userId: 1, unlockedAt: 1 }).catch(() => {});
  },

  async getUserBadges(userId: string): Promise<Array<BadgeDefinition & { unlocked: boolean; unlockedAt?: string; progress: number }>> {
    await this.ensureIndexes();
    await this.evaluateBadgesForUser(userId);

    const db = await getDb();
    const unlockedDocs = await db.collection<UserBadgeDoc>('user_badges').find({ userId }).toArray();
    const unlockedMap = new Map(unlockedDocs.map((doc) => [doc.badgeId, doc]));

    // Query live user progress metrics
    const metrics = await this.getUserMetrics(userId);

    return BADGE_DEFINITIONS.map((b) => {
      const doc = unlockedMap.get(b.id);
      const isUnlocked = !!doc;
      const progressVal = doc ? doc.progress : Math.min(b.threshold, metrics[b.id] ?? 0);

      return {
        ...b,
        unlocked: isUnlocked,
        unlockedAt: doc?.unlockedAt,
        progress: progressVal,
      };
    });
  },

  async getUserMetrics(userId: string): Promise<Record<string, number>> {
    const db = await getDb();

    // 1. Assessments
    const tests = await db.collection('assessment_results').find({ userId }).toArray();
    const testScores = tests.map((t) => Number(t.scorePercent) || 0);
    const testsCount = tests.length;
    const maxTestScore = testScores.length > 0 ? Math.max(...testScores) : 0;

    // 2. Streak
    const today = new Date().toISOString().slice(0, 10);
    const streakInfo = await activityStore.computeStreak(userId, today);
    const maxStreak = Math.max(streakInfo.currentStreak, streakInfo.longestStreak);

    // 3. Flashcards mastered
    const flashcardsMastered = await db.collection('flashcards').countDocuments({
      userId,
      $or: [{ stage: 'mastered' }, { interval: { $gte: 21 } }],
    });

    // 4. Planner stage passed
    const plannerPassedCount = await db.collection('planner_test_attempts').countDocuments({
      userId,
      passed: true,
    });

    // 5. Coding solved
    const solvedSubmissions = await db.collection('coding_submissions').find({
      userId,
      $or: [{ status: 'accepted' }, { verdict: 'accepted' }, { verdict: 'Accepted' }],
    }).toArray();
    const distinctSolved = new Set(solvedSubmissions.map((s) => s.problemId || s.problemSlug)).size;

    // 6. Interview score
    const interviews = await db.collection('interview_reports').find({ userId }).toArray();
    const interviewScores = interviews.map((i) => Number(i.overallScore) || 0);
    const maxInterviewScore = interviewScores.length > 0 ? Math.max(...interviewScores) : 0;

    // 7. Mistakes resolved
    const mistakesResolved = await db.collection('mistakes').countDocuments({
      userId,
      resolved: true,
    });

    // 8. Documents
    const documentsCount = await db.collection('documents').countDocuments({ userId });

    // 9. Focus minutes
    const focusEvents = await db.collection('activity_events').find({
      userId,
      type: { $in: ['focus', 'focus_minutes'] },
    }).toArray();
    const focusMinutes = focusEvents.reduce((sum, ev) => {
      const duration =
        (ev.meta?.durationMinutes as number) ||
        (ev.meta?.minutes as number) ||
        (ev.points ? ev.points * 25 : 25);
      return sum + duration;
    }, 0);

    // 10. Study groups
    const user = await db.collection('users').findOne({ $or: [{ id: userId }, { _id: userId as any }] });
    const userEmail = user?.email;
    const groupCount = await db.collection('study_groups').countDocuments({
      $or: [
        { ownerId: userId },
        { 'members.userId': userId },
        ...(userEmail ? [{ 'members.email': userEmail }] : []),
      ],
    });

    return {
      first_mock_test: testsCount,
      score_90_plus: maxTestScore,
      streak_3: maxStreak,
      streak_7: maxStreak,
      streak_30: maxStreak,
      flashcards_10_mastered: flashcardsMastered,
      first_planner_stage_passed: plannerPassedCount,
      coding_first_solve: distinctSolved,
      coding_5_solved: distinctSolved,
      interview_70_plus: maxInterviewScore,
      mistakes_10_resolved: mistakesResolved,
      first_document_analyzed: documentsCount,
      focus_5_hours: focusMinutes,
      joined_study_group: groupCount,
    };
  },

  async evaluateBadgesForUser(userId: string): Promise<UserBadgeDoc[]> {
    const db = await getDb();
    const col = db.collection<UserBadgeDoc>('user_badges');
    const existing = await col.find({ userId }).toArray();
    const existingMap = new Map(existing.map((doc) => [doc.badgeId, doc]));

    const metrics = await this.getUserMetrics(userId);
    const newlyUnlocked: UserBadgeDoc[] = [];

    for (const b of BADGE_DEFINITIONS) {
      const currentVal = metrics[b.id] ?? 0;
      const existingDoc = existingMap.get(b.id);

      if (!existingDoc && currentVal >= b.threshold) {
        const doc: UserBadgeDoc = {
          userId,
          badgeId: b.id,
          unlockedAt: new Date().toISOString(),
          progress: currentVal,
        };
        try {
          await col.updateOne(
            { userId, badgeId: b.id },
            { $setOnInsert: doc },
            { upsert: true }
          );
          newlyUnlocked.push(doc);

          // Create notification in DB
          await db.collection('notifications').insertOne({
            userId,
            message: `🏆 Unlocked Achievement: "${b.name}"! +${b.xpReward} XP`,
            read: false,
            createdAt: new Date().toISOString(),
          });

          // Award badge XP once
          await db.collection('user_gamification').updateOne(
            { userId },
            { $inc: { totalXp: b.xpReward } }
          );

          // Emit real-time notification
          emitToUser(userId, 'badge:unlocked', { badge: b });
        } catch {
          // Handled duplicate gracefully
        }
      } else if (existingDoc && currentVal > existingDoc.progress) {
        // Update progress tracking
        await col.updateOne({ userId, badgeId: b.id }, { $set: { progress: currentVal } });
      }
    }

    return newlyUnlocked;
  },
};
