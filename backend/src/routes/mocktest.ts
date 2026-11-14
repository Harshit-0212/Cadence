import { Router } from 'express';
import { generateQuestionsFromTopic, suggestTopics, GeminiError, type GeneratedQuestion } from '../lib/gemini.js';
import { assessmentStore } from '../lib/assessments.js';
import { mockTestSessionStore } from '../lib/mockTestSessions.js';
import { activityStore } from '../lib/activityStore.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { emitToUser } from '../lib/socket.js';
import { resolveEffectiveTimezone, getDateKeyForTimezone } from '../lib/timezone.js';

export const mocktestRouter = Router();

const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'] as const;

function resolveDateKey(timezone?: string, localDate?: string): string {
  if (typeof localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return localDate;
  }
  const tz = resolveEffectiveTimezone(timezone).timezone;
  return getDateKeyForTimezone(new Date(), tz);
}

function getFallbackQuestions(subject: string, count: number): GeneratedQuestion[] {
  const bank: GeneratedQuestion[] = [
    {
      type: 'mcq',
      prompt: `In ${subject}, what is the time complexity of searching an element in a balanced binary search tree?`,
      options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
      correctAnswer: 'O(log n)',
      explanation: 'Each comparison in a balanced BST halves the search space, giving logarithmic time complexity O(log n).',
      topic: 'Search Complexity',
      difficulty: 'easy',
    },
    {
      type: 'mcq',
      prompt: `Which data structure operates on a Last In, First Out (LIFO) order in ${subject}?`,
      options: ['Queue', 'Stack', 'Linked List', 'Priority Queue'],
      correctAnswer: 'Stack',
      explanation: 'A stack is a linear data structure that follows the LIFO principle for push and pop operations.',
      topic: 'Stack Operations',
      difficulty: 'easy',
    },
    {
      type: 'true-false',
      prompt: 'An adjacency matrix for an undirected graph with V vertices requires O(V^2) space.',
      options: ['True', 'False'],
      correctAnswer: 'True',
      explanation: 'An adjacency matrix is a 2D V x V array, requiring quadratic O(V^2) space regardless of the number of edges.',
      topic: 'Graph Representations',
      difficulty: 'medium',
    },
    {
      type: 'short-answer',
      prompt: 'The technique of storing previously computed subproblem results in dynamic programming is called ___.',
      correctAnswer: 'memoization',
      explanation: 'Memoization is top-down dynamic programming where function results are cached for subsequent calls.',
      topic: 'Dynamic Programming',
      difficulty: 'medium',
    },
    {
      type: 'mcq',
      prompt: 'What is the worst-case time complexity of QuickSort?',
      options: ['O(n)', 'O(n log n)', 'O(n^2)', 'O(2^n)'],
      correctAnswer: 'O(n^2)',
      explanation: 'When the partition strategy continually chooses the most extreme element as pivot, QuickSort degrades to O(n^2).',
      topic: 'Sorting Algorithms',
      difficulty: 'hard',
    },
  ];
  return bank.slice(0, Math.min(count, bank.length));
}

mocktestRouter.post('/generate', requireAuth, async (req: AuthedRequest, res) => {
  const { subject, topics, difficulty, numQuestions } = req.body ?? {};

  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    res.status(400).json({ error: { message: 'subject is required.' } });
    return;
  }

  const safeTopics = Array.isArray(topics) ? topics.filter((t): t is string => typeof t === 'string') : [];
  const diff = DIFFICULTIES.includes(difficulty) ? difficulty : 'mixed';
  const count = Math.min(Math.max(Number(numQuestions) || 5, 3), 15);

  try {
    let questions: GeneratedQuestion[];
    try {
      questions = await generateQuestionsFromTopic({
        subject,
        topics: safeTopics,
        difficulty: diff,
        numQuestions: count,
      });
    } catch (aiErr) {
      if (aiErr instanceof GeminiError) {
        console.warn(`[mocktest] Gemini unavailable (${aiErr.message}), using verified fallback questions.`);
        questions = getFallbackQuestions(subject, count);
      } else {
        throw aiErr;
      }
    }

    const session = await mockTestSessionStore.create(req.userId!, subject, questions);
    res.json({
      data: {
        testId: session.id,
        subject: session.subject,
        questions: session.questions,
        status: session.status,
      },
    });
  } catch (err) {
    console.error('Mock test generation failed:', err);
    res.status(500).json({ error: { message: 'Something went wrong generating the test. Please try again.' } });
  }
});

mocktestRouter.get('/active', requireAuth, async (req: AuthedRequest, res) => {
  const activeAttempt = await mockTestSessionStore.getActiveAttempt(req.userId!);
  res.json({ data: { attempt: activeAttempt } });
});

mocktestRouter.patch('/progress/:testId', requireAuth, async (req: AuthedRequest, res) => {
  const { testId } = req.params;
  const { answers, currentQIndex, timeRemainingSeconds } = req.body ?? {};

  const updated = await mockTestSessionStore.updateProgress(testId, req.userId!, {
    answers,
    currentQIndex,
    timeRemainingSeconds,
  });
  res.json({ data: { success: updated } });
});

mocktestRouter.post('/abandon/:testId', requireAuth, async (req: AuthedRequest, res) => {
  const { testId } = req.params;
  const success = await mockTestSessionStore.abandon(testId, req.userId!);
  res.json({ data: { success } });
});

mocktestRouter.post('/suggest-topics', requireAuth, async (req, res) => {
  const { subject, weakTopics } = req.body ?? {};

  if (!subject || typeof subject !== 'string') {
    res.status(400).json({ error: { message: 'subject is required.' } });
    return;
  }

  const safeWeakTopics = Array.isArray(weakTopics) ? weakTopics.filter((t): t is string => typeof t === 'string') : [];

  try {
    const topics = await suggestTopics({ subject, weakTopics: safeWeakTopics });
    res.json({ data: { topics } });
  } catch (err) {
    if (err instanceof GeminiError) {
      res.status(502).json({ error: { message: err.message } });
      return;
    }
    console.error('Topic suggestion failed:', err);
    res.status(500).json({ error: { message: 'Something went wrong suggesting topics. Please try again.' } });
  }
});

mocktestRouter.post('/submit', requireAuth, async (req: AuthedRequest, res) => {
  const { testId, answers, timeSpentSeconds, timezone, localDate } = req.body ?? {};

  if (!testId || typeof testId !== 'string') {
    res.status(400).json({ error: { message: 'testId is required.' } });
    return;
  }

  const session = await mockTestSessionStore.get(testId, req.userId!);
  if (!session) {
    res.status(404).json({ error: { message: 'This test session has expired. Please generate a new test.' } });
    return;
  }

  const safeAnswers: Record<string, string> = answers && typeof answers === 'object' ? answers : {};

  const perQuestion = session.questions.map((q) => ({
    questionId: q.id,
    correct: (safeAnswers[q.id] ?? '').trim().toLowerCase() === q.correctAnswer.trim().toLowerCase(),
  }));
  const correctCount = perQuestion.filter((p) => p.correct).length;
  const weakAreas = Array.from(
    new Set(session.questions.filter((q) => !perQuestion.find((p) => p.questionId === q.id)?.correct).map((q) => q.topic)),
  );

  const topicTotals = new Map<string, { correct: number; total: number }>();
  session.questions.forEach((q) => {
    const entry = topicTotals.get(q.topic) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (perQuestion.find((p) => p.questionId === q.id)?.correct) entry.correct += 1;
    topicTotals.set(q.topic, entry);
  });
  const topicBreakdown = Array.from(topicTotals.entries()).map(([topic, v]) => ({ topic, ...v }));
  const scorePercent = Math.round((correctCount / session.questions.length) * 100);

  // 1. Create the assessment result
  const result = await assessmentStore.create({
    userId: req.userId!,
    testId: session.id,
    kind: 'mock-test',
    subject: session.subject,
    scorePercent,
    correctCount,
    totalQuestions: session.questions.length,
    timeSpentSeconds: Number(timeSpentSeconds) || 0,
    weakAreas,
    topicBreakdown,
  });

  // 2. Mark session attempt as submitted with link to result
  await mockTestSessionStore.markSubmitted(testId, req.userId!, result.id);

  // 3. ATOMIC WRITE: Record activity_event in the SAME request
  const dateKey = resolveDateKey(timezone, localDate);
  await activityStore.recordActivity(
    req.userId!,
    'mock_test',
    dateKey,
    4,
    {
      title: `${session.subject} Mock Test (${scorePercent}%)`,
      resultId: result.id,
      scorePercent,
      correctCount,
      totalQuestions: session.questions.length,
    },
    `mock_test:${result.id}`
  );

  // 4. Push real-time event to socket
  emitToUser(req.userId!, 'stats:invalidate', { reason: 'mock_test_submitted', resultId: result.id });

  res.json({
    data: {
      testId: result.id,
      attemptId: session.id,
      subject: result.subject,
      takenAt: result.takenAt,
      scorePercent: result.scorePercent,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      timeSpentSeconds: result.timeSpentSeconds,
      weakAreas: result.weakAreas,
      perQuestion,
      topicBreakdown: result.topicBreakdown,
    },
  });
});

mocktestRouter.get('/results', requireAuth, async (req: AuthedRequest, res) => {
  const results = await assessmentStore.listByUser(req.userId!);
  const mockTestResults = results
    .filter((r) => r.kind === 'mock-test')
    .map((r) => ({
      testId: r.id,
      subject: r.subject,
      takenAt: r.takenAt,
      scorePercent: r.scorePercent ?? 0,
      correctCount: r.correctCount ?? 0,
      totalQuestions: r.totalQuestions ?? 0,
      timeSpentSeconds: r.timeSpentSeconds ?? 0,
      weakAreas: r.weakAreas,
      topicBreakdown: r.topicBreakdown ?? [],
    }));
  res.json({ data: { results: mockTestResults } });
});

mocktestRouter.get('/results/:id', requireAuth, async (req: AuthedRequest, res) => {
  const results = await assessmentStore.listByUser(req.userId!);
  const found = results.find(
    (r) =>
      r.id === req.params.id ||
      r.testId === req.params.id ||
      (r as unknown as Record<string, unknown>).attemptId === req.params.id
  );
  if (!found) {
    res.status(404).json({ error: { message: 'Result not found' } });
    return;
  }

  // Lookup session attempt to attach full questions, user answers, and perQuestion
  const session = found.testId ? await mockTestSessionStore.get(found.testId, req.userId!) : null;
  const questions = session?.questions || [];
  const userAnswers = session?.answers || {};

  const perQuestion = questions.map((q) => {
    const userAns = (userAnswers[q.id] || '').trim();
    const correctAns = (q.correctAnswer || '').trim();
    const isCorrect = userAns.toLowerCase() === correctAns.toLowerCase();
    return {
      questionId: q.id,
      prompt: q.prompt,
      userAnswer: userAns || 'Not Answered',
      correctAnswer: correctAns,
      correct: isCorrect,
      isCorrect,
      explanation: q.explanation || '',
      topic: q.topic || 'General',
    };
  });

  res.json({
    data: {
      result: {
        ...found,
        testId: found.id,
        attemptId: found.testId,
        test: session
          ? {
              id: session.id,
              subject: session.subject,
              config: { subject: session.subject, topics: [], difficulty: 'mixed', numQuestions: session.questions.length },
              questions: session.questions,
              createdAt: new Date(session.createdAt).toISOString(),
              timeLimitSeconds: session.questions.length * 90,
            }
          : undefined,
        questions,
        userAnswers,
        perQuestion,
      },
    },
  });
});
