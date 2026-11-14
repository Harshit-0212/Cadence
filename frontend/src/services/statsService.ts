import { fetchApi } from './api';

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

export const statsService = {
  getUserTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  },

  getUserLocalDate(): string {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: this.getUserTimezone() }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  },

  async getSummary(): Promise<StatsSummary> {
    const params = new URLSearchParams({
      timezone: this.getUserTimezone(),
      localDate: this.getUserLocalDate(),
    });

    const res = (await fetchApi(`/stats/summary?${params.toString()}`)) as any;
    return res?.data ?? res;
  },
};

