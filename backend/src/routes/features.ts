import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { learningStore } from '../lib/learningStore.js';
import { gamificationStore } from '../lib/gamificationStore.js';
import { activityStore } from '../lib/activityStore.js';
import { emitToUser } from '../lib/socket.js';
import { getClientForUser } from '../lib/gemini.js';
import { config } from '../config.js';
import { getDateKeyForTimezone } from '../lib/timezone.js';
import { userStore } from '../lib/users.js';
import { getDb } from '../lib/db.js';
import {
  preCheckAnswer,
  buildStrictRubricPrompt,
  enforceGradingRules,
  type RubricEvaluation,
} from '../lib/interviewGrading.js';

export const featuresRouter = Router();
featuresRouter.use(requireAuth);

// ─── Mistakes ─────────────────────────────────────────────────────────────────
featuresRouter.get('/mistakes', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { subject, topic, unresolvedOnly } = req.query;
  const list = await learningStore.listMistakes(userId, {
    subject: subject as string,
    topic: topic as string,
    unresolvedOnly: unresolvedOnly === 'true',
  });
  res.json({ data: list });
});

featuresRouter.post('/mistakes', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { question, userAnswer, correctAnswer, subject, topic, explanation } = req.body;
  if (!question || !correctAnswer) {
    res.status(400).json({ error: { message: 'Question and correct answer required' } });
    return;
  }
  const mistake = await learningStore.recordMistake({
    userId,
    question,
    userAnswer: userAnswer || '',
    correctAnswer,
    subject: subject || 'General',
    topic: topic || 'General',
    explanation: explanation || 'Review this question to understand the correct concept.',
  });
  res.status(201).json({ data: mistake });
});

featuresRouter.post('/mistakes/:id/resolve', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const mistake = await learningStore.getMistake(userId, req.params.id);
  if (mistake?.resolved) {
    res.json({ data: { success: true, alreadyResolved: true } });
    return;
  }
  const success = await learningStore.resolveMistake(userId, req.params.id);
  if (success) {
    const user = await userStore.findById(userId);
    const today = getDateKeyForTimezone(new Date(), user?.timezone || 'Asia/Kolkata');
    await gamificationStore.recordLearningEvent(userId, 'quiz_completed', today, `mistake_${req.params.id}`);
    await activityStore.recordActivity(
      userId,
      'mistake_retry',
      today,
      1,
      { mistakeId: req.params.id },
      `mistake:${req.params.id}`
    );
    emitToUser(userId, 'stats:invalidate', { reason: 'mistake_resolved', mistakeId: req.params.id });
  }
  res.json({ data: { success, alreadyResolved: false } });
});

featuresRouter.post('/mistakes/:id/reopen', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const success = await learningStore.reopenMistake(userId, req.params.id);
  if (success) {
    emitToUser(userId, 'stats:invalidate', { reason: 'mistake_reopened', mistakeId: req.params.id });
  }
  res.json({ data: { success } });
});

// ─── Flashcards ───────────────────────────────────────────────────────────────
featuresRouter.get('/flashcards/due', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const due = await learningStore.getDueFlashcards(userId);
  res.json({ data: due });
});

featuresRouter.get('/flashcards/all', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const allCards = await learningStore.getAllFlashcards(userId);
  res.json({ data: allCards });
});

featuresRouter.post('/flashcards', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { front, back, subject, topic, sourceDocId, sourceMistakeId, distractors, clozeText } = req.body;
  if (!front || !back) {
    res.status(400).json({ error: { message: 'Front and back required' } });
    return;
  }

  // Calculate normalized content hash for deduplication
  const normFront = front.toLowerCase().replace(/[^a-z0-9]/g, '');
  const contentHash = crypto.createHash('sha256').update(normFront).digest('hex');

  try {
    const card = await learningStore.createFlashcard({
      userId,
      front,
      back,
      subject: subject || 'General',
      topic: topic || 'General',
      sourceDocId,
      sourceMistakeId,
      contentHash,
      distractors,
      clozeText,
    });
    res.status(201).json({ data: card, created: 1, skipped: 0 });
  } catch (err: any) {
    if (err?.code === 11000) {
      // Duplicate card skipped
      res.json({ data: null, created: 0, skipped: 1, message: 'Card already exists in library.' });
      return;
    }
    res.status(500).json({ error: { message: err?.message || 'Failed to create flashcard' } });
  }
});

featuresRouter.post('/flashcards/generate-for-document', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { documentId, documentName, documentContent, existingQuestions = [] } = req.body;

  if (!documentContent && !documentName) {
    res.status(400).json({ error: { message: 'Document content or title required.' } });
    return;
  }

  try {
    let generated: any[] = [];
    try {
      const ai = await getClientForUser(userId);
      const model = ai.getGenerativeModel({
        model: config.geminiModel,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });

      const prompt = `You are an educational tutor generating high-yield active-recall flashcards from this document.
Document Name: "${documentName || 'Document'}"
Content Excerpt:
"${(documentContent || documentName || '').slice(0, 4000)}"

IMPORTANT ANTI-DUPLICATION RULE:
Do NOT repeat or paraphrase any of these questions already generated:
${JSON.stringify(existingQuestions)}

Generate between 3 to 6 NEW, distinct flashcards.
Each flashcard must contain:
- "front": clear active-recall question
- "back": concise, precise answer
- "subject": subject area (e.g. Operating Systems, DSA, etc.)
- "topic": specific subtopic
- "distractors": exactly 3 plausible incorrect options for multiple-choice mode
- "clozeText": fill-in-the-blank variant with "___" replacing the core keyword

Output ONLY JSON matching:
{
  "flashcards": [
    {
      "front": string,
      "back": string,
      "subject": string,
      "topic": string,
      "distractors": [string, string, string],
      "clozeText": string
    }
  ]
}`;

      const result = await model.generateContent(prompt);
      let text = result.response.text().trim();
      text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(text);
      generated = parsed.flashcards || [];
    } catch {
      // Deterministic fallback generator if Gemini is unavailable or errors
      const rawContent = (documentContent || documentName || 'Key Concepts');
      const sentences = rawContent
        .split(/(?<=[.?!])\s+|\n+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 25);

      const count = Math.min(4, Math.max(2, sentences.length));
      for (let i = 0; i < count; i++) {
        const sentence = sentences[i] || `Key principle of ${documentName || 'Topic'}`;
        const words = sentence.split(/\s+/);
        const keyword = words[Math.min(3, words.length - 1)] || 'Concept';
        const q = `What is the significance of: "${words.slice(0, 6).join(' ')}..."?`;
        if (!existingQuestions.includes(q)) {
          generated.push({
            front: q,
            back: sentence,
            subject: 'Document Study',
            topic: documentName || 'Analysis',
            distractors: ['Alternative explanation A', 'Irrelevant theorem', 'Opposite mechanism'],
            clozeText: sentence.replace(keyword, '______'),
          });
        }
      }
    }
    let createdCount = 0;
    let skippedCount = 0;
    const newCards = [];

    for (const cardData of generated) {
      const normFront = (cardData.front || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const contentHash = crypto.createHash('sha256').update(normFront).digest('hex');

      try {
        const created = await learningStore.createFlashcard({
          userId,
          front: cardData.front,
          back: cardData.back,
          subject: cardData.subject || 'General',
          topic: cardData.topic || 'General',
          sourceDocId: documentId,
          contentHash,
          distractors: cardData.distractors || [],
          clozeText: cardData.clozeText || cardData.front,
        });
        createdCount++;
        newCards.push(created);
      } catch (err: any) {
        if (err?.code === 11000) {
          skippedCount++;
        }
      }
    }

    res.json({
      data: {
        cards: newCards,
        created: createdCount,
        skipped: skippedCount,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Flashcard generation failed';
    res.status(500).json({ error: { message: msg } });
  }
});

featuresRouter.post('/flashcards/:id/review', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { rating, reviewType } = req.body; // 1-4
  if (![1, 2, 3, 4].includes(rating)) {
    res.status(400).json({ error: { message: 'Rating must be between 1 and 4' } });
    return;
  }
  const updated = await learningStore.reviewFlashcard(userId, req.params.id, rating, reviewType);
  if (updated) {
    const user = await userStore.findById(userId);
    const today = getDateKeyForTimezone(new Date(), user?.timezone || 'Asia/Kolkata');
    if (rating >= 2) {
      await gamificationStore.recordLearningEvent(userId, 'comprehension_drill', today, `flashcard_${req.params.id}_${today}`);
    }
    await activityStore.recordActivity(
      userId,
      'flashcard',
      today,
      1,
      { cardId: req.params.id, rating },
      `flashcard:${req.params.id}:${today}`
    );
    emitToUser(userId, 'stats:invalidate', { reason: 'flashcard_reviewed', cardId: req.params.id });
  }
  res.json({ data: updated });
});

// ─── Calendar ─────────────────────────────────────────────────────────────────
featuresRouter.get('/calendar', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const events = await learningStore.listCalendarEvents(userId);
  res.json({ data: events });
});

featuresRouter.post('/calendar', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { title, type, date, time, description } = req.body;
  if (!title || !date) {
    res.status(400).json({ error: { message: 'Title and date required' } });
    return;
  }
  const event = await learningStore.createCalendarEvent({
    userId,
    title,
    type: type || 'custom',
    date,
    time,
    description,
  });
  res.status(201).json({ data: event });
});

featuresRouter.patch('/calendar/:id', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { title, type, date, time, description } = req.body;
  const updated = await learningStore.updateCalendarEvent(userId, req.params.id, {
    ...(title !== undefined ? { title } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(time !== undefined ? { time } : {}),
    ...(description !== undefined ? { description } : {}),
  });
  if (!updated) {
    res.status(404).json({ error: { message: 'Calendar event not found' } });
    return;
  }
  res.json({ data: updated });
});

featuresRouter.delete('/calendar/:id', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const success = await learningStore.deleteCalendarEvent(userId, req.params.id);
  res.json({ data: { success } });
});

// ─── Interview Prep ───────────────────────────────────────────────────────────
featuresRouter.post('/interview/evaluate', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const { role, topic, difficulty, questions } = req.body;
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    res.status(400).json({ error: { message: 'Questions and answers are required.' } });
    return;
  }

  try {
    const ai = await getClientForUser(userId);
    // Strict temperature: 0.1 for deterministic grading
    const model = ai.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const evaluatedQuestions = [];
    const collectedWeaknesses: Array<{
      area: string;
      reason: string;
      fix: string;
      studyRecommendation: string;
    }> = [];
    const collectedStrengths: string[] = [];

    let totalScore = 0;
    let validAnswersCount = 0;

    for (const item of questions) {
      const qText = item.question || '';
      const aText = (item.answer || '').trim();

      // Layer A: Deterministic algorithmic pre-checks
      const precheck = preCheckAnswer(qText, aText);

      if (!precheck.passed) {
        evaluatedQuestions.push({
          question: qText,
          userAnswer: aText,
          score: precheck.score, // 0 or capped at 1
          sampleAnswer: 'A comprehensive technical answer addressing the core mechanisms of this problem.',
          reason: precheck.reason,
        });
        totalScore += precheck.score;
        collectedWeaknesses.push({
          area: qText.slice(0, 35) + '...',
          reason: precheck.reason || 'Answer failed technical quality pre-checks.',
          fix: 'Provide structured technical explanations detailing core mechanisms, algorithmic complexity, and tradeoffs.',
          studyRecommendation: 'Practice foundational technical drilling in My Learning.',
        });
        continue;
      }

      // Layer B: Strict Gemini rubric with temperature 0.1 and evidence quotes
      const prompt = buildStrictRubricPrompt({
        role: role || 'Software Engineer',
        topic: topic || 'General CS',
        difficulty: difficulty || 'medium',
        question: qText,
        candidateAnswer: aText,
      });

      let parsedRubric: RubricEvaluation | null = null;
      let attempts = 0;

      while (attempts < 2 && !parsedRubric) {
        attempts++;
        try {
          const result = await model.generateContent(prompt);
          let text = result.response.text().trim();
          text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
          parsedRubric = JSON.parse(text);
        } catch {
          // If first attempt fails, loop will retry once.
        }
      }

      let finalRubric: RubricEvaluation;
      if (!parsedRubric) {
        // Fallback heuristic grading when AI fails after retry
        finalRubric = {
          relevant: true,
          coherent: true,
          correctness: 3,
          completeness: 2,
          clarity: 1,
          sampleAnswer: `A thorough response for "${qText}" details architecture, operational complexity, and production trade-offs.`,
          keyPointsCovered: [{ point: 'Addressed problem requirements', evidenceQuote: aText.slice(0, Math.min(60, aText.length)) }],
          keyPointsMissed: ['Detailed edge case considerations', 'Quantified performance metrics'],
          factualErrors: [],
        };
      } else {
        finalRubric = parsedRubric;
      }

      // Layer C: Server-side post-enforcement & quote verification
      const graded = enforceGradingRules(aText, finalRubric);
      validAnswersCount++;
      totalScore += graded.score;

      evaluatedQuestions.push({
        question: qText,
        userAnswer: aText,
        score: graded.score,
        sampleAnswer: graded.sampleAnswer,
        keyPointsCovered: graded.keyPointsCovered,
        keyPointsMissed: graded.keyPointsMissed,
        factualErrors: graded.factualErrors,
      });

      if (graded.keyPointsCovered.length > 0) {
        collectedStrengths.push(
          ...graded.keyPointsCovered.map((kp) => kp.point).slice(0, 2)
        );
      }

      if (graded.keyPointsMissed.length > 0) {
        collectedWeaknesses.push({
          area: qText.slice(0, 35) + '...',
          reason: `Missed key concepts: ${graded.keyPointsMissed.slice(0, 2).join(', ')}`,
          fix: `Study and incorporate: ${graded.keyPointsMissed.slice(0, 2).join(', ')} in future responses.`,
          studyRecommendation: 'Review technical flashcards and practice problems on this topic.',
        });
      }
    }

    const overallScore = Math.round(totalScore / questions.length);
    const technicalDepthScore = Math.min(100, Math.round(overallScore * 0.95));
    const communicationScore = validAnswersCount > 0 ? Math.min(100, Math.round(overallScore * 1.05)) : 0;
    const confidenceScore = overallScore > 50 ? 80 : Math.max(10, overallScore);

    const saved = await learningStore.saveInterviewReport({
      userId,
      role: role || 'Software Engineer',
      topic: topic || 'General CS',
      difficulty: difficulty || 'medium',
      overallScore,
      communicationScore,
      technicalDepthScore,
      confidenceScore,
      strengths: collectedStrengths.length > 0 ? Array.from(new Set(collectedStrengths)) : ['Attempted structured response'],
      weaknesses: collectedWeaknesses.length > 0 ? collectedWeaknesses : [
        {
          area: 'Deep System Architecture',
          reason: 'More detail could be provided on high-concurrency performance edge cases.',
          fix: 'Reference specific indexing and lock-free data structures.',
          studyRecommendation: 'Review advanced concurrency patterns.',
        },
      ],
      questions: evaluatedQuestions,
    });

    if (overallScore >= 0) {
      const user = await userStore.findById(userId);
      const today = getDateKeyForTimezone(new Date(), user?.timezone || 'Asia/Kolkata');
      if (overallScore > 10) {
        await gamificationStore.recordLearningEvent(userId, 'comprehension_drill', today, `interview_${saved.id}`);
      }
      await activityStore.recordActivity(
        userId,
        'interview',
        today,
        4,
        { role, topic, overallScore, interviewId: saved.id },
        `interview:${saved.id}`
      );
      emitToUser(userId, 'stats:invalidate', { reason: 'interview_finished', interviewId: saved.id });
    }

    res.json({ data: saved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Evaluation failed';
    res.status(500).json({ error: { message: `AI evaluation error: ${msg}` } });
  }
});

featuresRouter.get('/interview/reports', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const reports = await learningStore.listInterviewReports(userId);
  res.json({ data: reports });
});

// -------------------------------------------------------------
// NOTIFICATIONS
// -------------------------------------------------------------
featuresRouter.get('/notifications', async (req: AuthedRequest, res: Response) => {
  try {
    const db = await getDb();
    const notifications = await db
      .collection('notifications')
      .find({ userId: req.userId! })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();

    const formatted = notifications.map((n: any) => ({
      id: String(n._id),
      message: n.message,
      createdAt: n.createdAt,
      read: !!n.read,
    }));

    res.json({ data: formatted });
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message || 'Failed to fetch notifications' } });
  }
});

featuresRouter.post('/notifications/mark-read', async (req: AuthedRequest, res: Response) => {
  try {
    const db = await getDb();
    await db.collection('notifications').updateMany({ userId: req.userId! }, { $set: { read: true } });
    res.json({ data: { success: true } });
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message || 'Failed to mark notifications read' } });
  }
});
