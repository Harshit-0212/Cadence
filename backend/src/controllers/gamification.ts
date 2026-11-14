import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth.js';
import { gamificationStore, type LearningActionType } from '../lib/gamificationStore.js';
import { activityStore } from '../lib/activityStore.js';
import { getDb } from '../lib/db.js';
import { computeUserStatsSummary } from '../routes/stats.js';
import { badgesStore } from '../lib/achievements.js';

export const gamificationController = {
  async getLeaderboard(req: AuthedRequest, res: Response): Promise<void> {
    try {
      const db = await getDb();
      const users = await db.collection('users').find({}).toArray();

      // Fetch all unlocked badges to display next to user names
      const allUserBadges = await db.collection('user_badges').find({}).toArray();
      const badgesByUser = new Map<string, string[]>();
      for (const ub of allUserBadges) {
        if (!badgesByUser.has(ub.userId)) badgesByUser.set(ub.userId, []);
        badgesByUser.get(ub.userId)!.push(ub.badgeId);
      }

      // Compute server XP & stats for each user (single source of truth)
      const userProfiles = await Promise.all(
        users.map(async (u) => {
          const userId = u.id || String(u._id);
          const stats = await computeUserStatsSummary(userId);
          const doc = {
            userId,
            name: u.full_name || u.name || 'Anonymous Scholar',
            avatar: u.avatar_image,
            xp: stats.xp,
            level: stats.level,
            streak: stats.currentStreak,
            badges: badgesByUser.get(userId) || [],
            updatedAt: new Date().toISOString(),
          };

          // Maintain user_stats collection
          await db.collection('user_stats').updateOne(
            { userId },
            { $set: doc },
            { upsert: true }
          );

          return {
            ...doc,
            isUser: userId === req.userId,
          };
        })
      );

      // Rank purely by server XP (descending)
      userProfiles.sort((a, b) => b.xp - a.xp || b.streak - a.streak || a.name.localeCompare(b.name));

      const enriched = userProfiles.slice(0, 50).map((p, idx) => ({
        rank: idx + 1,
        userId: p.userId,
        name: p.name,
        avatar: p.avatar,
        xp: p.xp,
        level: p.level,
        streak: p.streak,
        badges: p.badges,
        isUser: p.isUser,
      }));

      // Ensure the requesting user's row is included even if outside top 50
      const userIndex = userProfiles.findIndex((p) => p.isUser);
      if (userIndex >= 50 && userIndex !== -1) {
        const u = userProfiles[userIndex];
        enriched.push({
          rank: userIndex + 1,
          userId: u.userId,
          name: u.name,
          avatar: u.avatar,
          xp: u.xp,
          level: u.level,
          streak: u.streak,
          badges: u.badges,
          isUser: true,
        });
      }

      res.json({ data: enriched });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch leaderboard.';
      res.status(500).json({ error: { message } });
    }
  },

  async getBadges(req: AuthedRequest, res: Response): Promise<void> {
    const userId = req.userId!;
    try {
      const badges = await badgesStore.getUserBadges(userId);
      res.json({ data: badges });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch badges.';
      res.status(500).json({ error: { message } });
    }
  },

  async getProfile(req: AuthedRequest, res: Response): Promise<void> {
    const userId = req.userId!;
    try {
      const profile = await gamificationStore.getProfile(userId);
      const today = new Date().toISOString().slice(0, 10);
      const computed = await activityStore.computeStreak(userId, today);
      
      const mergedProfile = {
        ...profile,
        currentStreak: Math.max(profile.currentStreak || 0, computed.currentStreak),
        longestStreak: Math.max(profile.longestStreak || 0, computed.longestStreak),
      };
      
      res.json({ data: mergedProfile });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch gamification profile.';
      res.status(500).json({ error: { message } });
    }
  },

  async recordAction(req: AuthedRequest, res: Response): Promise<void> {
    const userId = req.userId!;
    const { action, localDate, eventKey } = req.body || {};

    const validActions: LearningActionType[] = [
      'coding_accepted',
      'comprehension_drill',
      'quiz_completed',
      'curriculum_step',
    ];

    if (!action || !validActions.includes(action)) {
      res.status(400).json({ error: { message: 'Invalid or missing learning action.' } });
      return;
    }

    // Default to server date if not supplied or invalid
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const safeLocalDate =
      typeof localDate === 'string' && datePattern.test(localDate)
        ? localDate
        : new Date().toISOString().slice(0, 10);

    try {
      const outcome = await gamificationStore.recordLearningEvent(userId, action, safeLocalDate, eventKey);
      res.json({ data: outcome });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to record learning event.';
      res.status(500).json({ error: { message } });
    }
  },
};
