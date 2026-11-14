import type { MockTest, MockTestConfig, MockTestResult, MockTestSubmission, Question } from '@/types';
import { fetchApi } from './api';

const SECONDS_PER_QUESTION = 90;

export const mockTestService = {
  async generateTest(config: MockTestConfig): Promise<MockTest> {
    const data = (await fetchApi('/mocktest/generate', {
      method: 'POST',
      body: JSON.stringify(config),
    })) as { testId: string; questions: Question[] };

    return {
      id: data.testId,
      config,
      questions: data.questions,
      createdAt: new Date().toISOString(),
      timeLimitSeconds: data.questions.length * SECONDS_PER_QUESTION,
    };
  },

  async suggestTopics(subject: string, weakTopics: string[]): Promise<string[]> {
    const data = (await fetchApi('/mocktest/suggest-topics', {
      method: 'POST',
      body: JSON.stringify({ subject, weakTopics }),
    })) as { topics: string[] };
    return data.topics;
  },

  async submitTest(test: MockTest, submission: MockTestSubmission, timeSpentSeconds = 0): Promise<MockTestResult> {
    return (await fetchApi('/mocktest/submit', {
      method: 'POST',
      body: JSON.stringify({
        testId: test.id,
        answers: submission.answers,
        timeSpentSeconds,
      }),
    })) as MockTestResult;
  },

  async getResults(): Promise<MockTestResult[]> {
    const data = (await fetchApi('/mocktest/results')) as { results: MockTestResult[] };
    return data.results;
  },

  async getActiveAttempt(): Promise<{
    testId: string;
    subject: string;
    questions: Question[];
    answers: Record<string, string>;
    currentQuestionIndex: number;
    timeSpentSeconds: number;
    timerEndsAt?: number;
    timeLimitSeconds?: number;
    status: string;
  } | null> {
    const res = (await fetchApi('/mocktest/active')) as { attempt: any };
    return res.attempt || null;
  },

  async updateProgress(
    testId: string,
    answers: Record<string, string>,
    currentQuestionIndex?: number,
    timeSpentSeconds?: number
  ): Promise<boolean> {
    try {
      await fetchApi(`/mocktest/progress/${testId}`, {
        method: 'PATCH',
        body: JSON.stringify({ answers, currentQuestionIndex, timeSpentSeconds }),
      });
      return true;
    } catch {
      return false;
    }
  },

  async abandonTest(testId: string): Promise<boolean> {
    try {
      await fetchApi(`/mocktest/abandon/${testId}`, { method: 'POST' });
      return true;
    } catch {
      return false;
    }
  },

  async getResultById(id: string): Promise<MockTestResult | null> {
    try {
      const res = (await fetchApi(`/mocktest/results/${id}`)) as { result: MockTestResult };
      return res.result || null;
    } catch {
      return null;
    }
  },
};
