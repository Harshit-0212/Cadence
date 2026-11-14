import { fetchApi } from './api';

export interface UserGamificationData {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  streakFreezesAvailable: number;
  streakFreezeUsedDates: string[];
  totalXp: number;
  level: number;
  unlockedBadges: {
    id: string;
    title: string;
    description: string;
    icon: string;
    unlockedAt: string;
  }[];
  weeklyQuests: {
    id: string;
    title: string;
    target: number;
    current: number;
    xpReward: number;
    completed: boolean;
    weekStartDate: string;
  }[];
}

export interface BadgeItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'assessments' | 'streak' | 'study' | 'coding' | 'interviews' | 'community';
  threshold: number;
  xpReward: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  howToEarn: string;
  unlocked: boolean;
  unlockedAt?: string;
  progress: number;
}

export interface LeaderboardUser {
  rank: number;
  userId: string;
  name: string;
  avatar?: string;
  xp: number;
  level: number;
  streak: number;
  badges?: string[];
  isUser: boolean;
}

export const gamificationService = {
  async getProfile(): Promise<UserGamificationData> {
    const res = await fetchApi('/gamification/profile');
    return (res as any)?.data ?? res;
  },

  async getLeaderboard(): Promise<LeaderboardUser[]> {
    const res = await fetchApi('/gamification/leaderboard');
    return (res as any)?.data ?? res;
  },

  async getBadges(): Promise<BadgeItem[]> {
    const res = await fetchApi('/gamification/badges');
    return (res as any)?.data ?? res;
  },

  async recordEvent(action: 'coding_accepted' | 'comprehension_drill' | 'quiz_completed' | 'curriculum_step'): Promise<{
    profile: UserGamificationData;
    xpAwarded: number;
    streakIncreased: boolean;
    freezeUsed: boolean;
    newBadges: string[];
  }> {
    const localDate = new Date().toISOString().slice(0, 10);
    const res = await fetchApi('/gamification/events', {
      method: 'POST',
      body: JSON.stringify({ action, localDate }),
    });
    return (res as any)?.data ?? res;
  },
};
