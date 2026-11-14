import type { MockTest, MockTestResult } from '@/types';

export interface SavedMockTestState {
  test: MockTest;
  answers: Record<string, string>;
  currentQ: number;
  timerEndsAt: number; // timestamp ms
  startedAt: number;
  subject: string;
}

const ACTIVE_TEST_STORAGE_KEY = 'cadence_active_mock_test_v1';
const LAST_RESULT_STORAGE_KEY = 'cadence_last_mock_test_result_v1';

export const mockTestStore = {
  saveActiveTest(state: SavedMockTestState): void {
    try {
      localStorage.setItem(ACTIVE_TEST_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or disabled
    }
  },

  getActiveTest(): SavedMockTestState | null {
    try {
      const data = localStorage.getItem(ACTIVE_TEST_STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data) as SavedMockTestState;
      if (!parsed.test || !parsed.test.id) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  updateAnswers(answers: Record<string, string>, currentQ?: number): void {
    const existing = this.getActiveTest();
    if (!existing) return;
    existing.answers = answers;
    if (typeof currentQ === 'number') existing.currentQ = currentQ;
    this.saveActiveTest(existing);
  },

  clearActiveTest(): void {
    try {
      localStorage.removeItem(ACTIVE_TEST_STORAGE_KEY);
    } catch {
      // Ignore
    }
  },

  saveLastResult(result: MockTestResult): void {
    try {
      localStorage.setItem(LAST_RESULT_STORAGE_KEY, JSON.stringify(result));
    } catch {
      // Ignore
    }
  },

  getLastResult(): MockTestResult | null {
    try {
      const data = localStorage.getItem(LAST_RESULT_STORAGE_KEY);
      if (!data) return null;
      return JSON.parse(data) as MockTestResult;
    } catch {
      return null;
    }
  },
};

