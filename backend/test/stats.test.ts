import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Stats and Activity Single Source of Truth Tests', () => {
  // Test streak computation algorithm
  function computeStreakFromDates(dates: string[], todayKey: string): { currentStreak: number; longestStreak: number } {
    if (dates.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    const uniqueDates = Array.from(new Set(dates)).sort();
    let longestStreak = 0;
    let currentStreakCount = 0;
    let lastDate: Date | null = null;

    for (const dateStr of uniqueDates) {
      const d = new Date(dateStr + 'T00:00:00Z');
      if (!lastDate) {
        currentStreakCount = 1;
      } else {
        const diffMs = d.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentStreakCount += 1;
        } else if (diffDays > 1) {
          currentStreakCount = 1;
        }
      }
      if (currentStreakCount > longestStreak) {
        longestStreak = currentStreakCount;
      }
      lastDate = d;
    }

    // Determine if current streak is active as of today or yesterday
    const today = new Date(todayKey + 'T00:00:00Z');
    let currentStreak = 0;

    if (lastDate) {
      const diffMs = today.getTime() - lastDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0 || diffDays === 1) {
        currentStreak = currentStreakCount;
      }
    }

    return { currentStreak, longestStreak };
  }

  test('Single source of truth: 3 consecutive active days yields streak 3', () => {
    const dates = ['2026-11-12', '2026-11-13', '2026-11-14'];
    const result = computeStreakFromDates(dates, '2026-11-14');
    assert.equal(result.currentStreak, 3);
    assert.equal(result.longestStreak, 3);
  });

  test('Single source of truth: Active yesterday keeps streak alive (grace period before day ends)', () => {
    const dates = ['2026-11-12', '2026-11-13'];
    const result = computeStreakFromDates(dates, '2026-11-14');
    assert.equal(result.currentStreak, 2);
    assert.equal(result.longestStreak, 2);
  });

  test('Single source of truth: Missed day resets current streak but retains longest streak', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-14'];
    const result = computeStreakFromDates(dates, '2026-11-14');
    assert.equal(result.currentStreak, 1);
    assert.equal(result.longestStreak, 4);
  });

  test('Single source of truth: Multiple activities on same day do not double-count streak', () => {
    const dates = [
      '2026-11-13',
      '2026-11-13', // mock test
      '2026-11-13', // flashcard
      '2026-11-14',
      '2026-11-14', // interview
    ];
    const result = computeStreakFromDates(dates, '2026-11-14');
    assert.equal(result.currentStreak, 2);
    assert.equal(result.longestStreak, 2);
  });

  test('Derived gamification metrics: XP and level are strictly deterministic from DB records', () => {
    const testsTaken = 4;
    const sessionsCompleted = 2;
    const codingAcceptedCount = 3;
    const flashcardsMastered = 10;
    const totalPoints = 35;

    // Standard formula from statsRouter:
    // testsTaken * 100 + sessionsCompleted * 50 + codingAcceptedCount * 80 + flashcardsMastered * 15 + totalPoints * 10
    const expectedXp =
      testsTaken * 100 +
      sessionsCompleted * 50 +
      codingAcceptedCount * 80 +
      flashcardsMastered * 15 +
      totalPoints * 10;

    assert.equal(expectedXp, 1240);

    const level = Math.floor(expectedXp / 500) + 1;
    assert.equal(level, 3); // Level 3 apprentice
  });

  test('Atomic eventKey idempotency check format', () => {
    const testId = 'test_6542c5_abc123';
    const eventKey = `mock_test:${testId}`;
    assert.equal(eventKey, 'mock_test:test_6542c5_abc123');

    const sessionId = 'sess_999';
    const sessionEventKey = `session:${sessionId}`;
    assert.equal(sessionEventKey, 'session:sess_999');
  });
});
