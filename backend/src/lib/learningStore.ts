import crypto from 'node:crypto';
import { getDb } from './db.js';

function randomId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export interface MistakeRecord {
  id: string;
  userId: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  subject: string;
  topic: string;
  explanation: string;
  resolved: boolean;
  retriesCount: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface FlashcardRecord {
  id: string;
  userId: string;
  front: string;
  back: string;
  subject: string;
  topic: string;
  sourceDocId?: string;
  sourceMistakeId?: string;
  contentHash?: string;
  stage?: 'new' | 'learning' | 'review' | 'mastered';
  leech?: boolean;
  leechCount?: number;
  distractors?: string[];
  clozeText?: string;
  lastReviewType?: 'flip' | 'mcq' | 'cloze' | 'type';
  repetition: number; // consecutive correct reviews
  interval: number; // days until next review
  easeFactor: number; // default 2.5
  nextReviewDate: string; // ISO string
  createdAt: string;
}

export interface CalendarEventRecord {
  id: string;
  userId: string;
  title: string;
  type: 'session' | 'mocktest' | 'flashcard' | 'interview' | 'exam' | 'custom';
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  description?: string;
  completed?: boolean;
  createdAt: string;
}

export interface InterviewReportRecord {
  id: string;
  userId: string;
  role: string;
  topic: string;
  difficulty: string;
  overallScore: number;
  communicationScore: number;
  technicalDepthScore: number;
  confidenceScore: number;
  strengths: string[];
  weaknesses: Array<{
    area: string;
    reason: string;
    fix: string;
    studyRecommendation: string;
  }>;
  questions: Array<{
    question: string;
    userAnswer: string;
    score: number;
    sampleAnswer: string;
  }>;
  createdAt: string;
}

export const learningStore = {
  // Mistakes
  async recordMistake(record: Omit<MistakeRecord, 'id' | 'resolved' | 'retriesCount' | 'createdAt'>): Promise<MistakeRecord> {
    const db = await getDb();
    const item: MistakeRecord = {
      ...record,
      id: randomId(),
      resolved: false,
      retriesCount: 0,
      createdAt: new Date().toISOString(),
    };
    await db.collection<MistakeRecord>('mistakes').insertOne(item);
    return item;
  },

  async listMistakes(userId: string, filters?: { subject?: string; topic?: string; unresolvedOnly?: boolean }): Promise<MistakeRecord[]> {
    const db = await getDb();
    const query: Record<string, any> = { userId };
    if (filters?.subject) query.subject = filters.subject;
    if (filters?.topic) query.topic = filters.topic;
    if (filters?.unresolvedOnly) query.resolved = false;
    return db.collection<MistakeRecord>('mistakes').find(query).sort({ createdAt: -1 }).toArray();
  },

  async resolveMistake(userId: string, id: string): Promise<boolean> {
    const db = await getDb();
    const res = await db.collection<MistakeRecord>('mistakes').updateOne(
      { id, userId },
      { $set: { resolved: true, resolvedAt: new Date().toISOString() }, $inc: { retriesCount: 1 } }
    );
    return res.matchedCount > 0;
  },

  // Flashcards (SM-2 Algorithm with Stages & Deduplication)
  async createFlashcard(data: Omit<FlashcardRecord, 'id' | 'repetition' | 'interval' | 'easeFactor' | 'nextReviewDate' | 'createdAt'> & { contentHash?: string }): Promise<FlashcardRecord> {
    const db = await getDb();
    const col = db.collection<FlashcardRecord>('flashcards');

    // Ensure unique compound index on userId, sourceDocId, contentHash
    try {
      await col.createIndex(
        { userId: 1, sourceDocId: 1, contentHash: 1 },
        { unique: true, sparse: true }
      );
    } catch {
      // Index might already exist
    }

    const item: FlashcardRecord = {
      ...data,
      id: randomId(),
      stage: data.stage || 'new',
      leech: false,
      leechCount: 0,
      repetition: 0,
      interval: 1,
      easeFactor: 2.5,
      nextReviewDate: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await col.insertOne(item);
    return item;
  },

  async getDueFlashcards(userId: string): Promise<FlashcardRecord[]> {
    const db = await getDb();
    const nowIso = new Date().toISOString();
    return db.collection<FlashcardRecord>('flashcards')
      .find({ userId, nextReviewDate: { $lte: nowIso } })
      .toArray();
  },

  async getAllFlashcards(userId: string): Promise<FlashcardRecord[]> {
    const db = await getDb();
    return db.collection<FlashcardRecord>('flashcards')
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
  },

  async reviewFlashcard(userId: string, id: string, rating: 1 | 2 | 3 | 4, reviewType?: 'flip' | 'mcq' | 'cloze' | 'type'): Promise<FlashcardRecord | null> {
    const db = await getDb();
    const card = await db.collection<FlashcardRecord>('flashcards').findOne({ id, userId });
    if (!card) return null;

    // SM-2 calculation: rating 1=Again, 2=Hard, 3=Good, 4=Easy
    let { repetition, interval, easeFactor } = card;
    let leechCount = card.leechCount || 0;
    let leech = card.leech || false;

    if (rating < 3) {
      repetition = 0;
      interval = 1;
      leechCount += 1;
      if (leechCount >= 4) {
        leech = true;
      }
    } else {
      if (repetition === 0) interval = 1;
      else if (repetition === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      repetition += 1;
    }

    // Determine Stage based on repetition and interval
    let stage: FlashcardRecord['stage'] = 'learning';
    if (repetition === 0) {
      stage = 'learning';
    } else if (interval < 7) {
      stage = 'learning';
    } else if (interval >= 7 && interval < 21) {
      stage = 'review';
    } else {
      stage = 'mastered';
    }

    // Next review type in rotation (flip -> mcq -> cloze -> type -> flip)
    const reviewModes: Array<'flip' | 'mcq' | 'cloze' | 'type'> = ['flip', 'mcq', 'cloze', 'type'];
    const currentMode = reviewType || card.lastReviewType || 'flip';
    const nextIdx = (reviewModes.indexOf(currentMode) + 1) % reviewModes.length;
    const nextReviewType = reviewModes[nextIdx];

    // Ease Factor adjustment
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (4 - rating) * (0.08 + (4 - rating) * 0.02)));

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    const nextReviewDate = nextDate.toISOString();

    await db.collection<FlashcardRecord>('flashcards').updateOne(
      { id, userId },
      {
        $set: {
          repetition,
          interval,
          easeFactor,
          nextReviewDate,
          stage,
          leech,
          leechCount,
          lastReviewType: nextReviewType,
        },
      }
    );

    // Record review log
    await db.collection('flashcard_reviews').insertOne({
      id: randomId(),
      userId,
      cardId: id,
      rating,
      reviewType: currentMode,
      reviewedAt: new Date().toISOString(),
    });

    return {
      ...card,
      repetition,
      interval,
      easeFactor,
      nextReviewDate,
      stage,
      leech,
      leechCount,
      lastReviewType: nextReviewType,
    };
  },

  // Calendar events
  async listCalendarEvents(userId: string): Promise<CalendarEventRecord[]> {
    const db = await getDb();
    return db.collection<CalendarEventRecord>('calendar_events').find({ userId }).sort({ date: 1 }).toArray();
  },

  async createCalendarEvent(data: Omit<CalendarEventRecord, 'id' | 'createdAt'>): Promise<CalendarEventRecord> {
    const db = await getDb();
    const item: CalendarEventRecord = {
      ...data,
      id: randomId(),
      createdAt: new Date().toISOString(),
    };
    await db.collection<CalendarEventRecord>('calendar_events').insertOne(item);
    return item;
  },

  async deleteCalendarEvent(userId: string, id: string): Promise<boolean> {
    const db = await getDb();
    const res = await db.collection<CalendarEventRecord>('calendar_events').deleteOne({ id, userId });
    return res.deletedCount > 0;
  },

  // Interview reports
  async saveInterviewReport(report: Omit<InterviewReportRecord, 'id' | 'createdAt'>): Promise<InterviewReportRecord> {
    const db = await getDb();
    const item: InterviewReportRecord = {
      ...report,
      id: randomId(),
      createdAt: new Date().toISOString(),
    };
    await db.collection<InterviewReportRecord>('interview_reports').insertOne(item);
    return item;
  },

  async listInterviewReports(userId: string): Promise<InterviewReportRecord[]> {
    const db = await getDb();
    return db.collection<InterviewReportRecord>('interview_reports').find({ userId }).sort({ createdAt: -1 }).toArray();
  },
};
