import { getDb } from './db.js';
import type { GeneratedQuestion } from './gemini.js';

export interface StoredMockTestQuestion extends GeneratedQuestion {
  id: string;
}

export interface StoredMockTestSession {
  id: string;
  userId: string;
  subject: string;
  questions: StoredMockTestQuestion[];
  status: 'in_progress' | 'submitted' | 'abandoned';
  currentQIndex?: number;
  answers?: Record<string, string>;
  timeRemainingSeconds?: number;
  resultId?: string;
  createdAt: number;
  updatedAt: number;
}

const COLLECTION = 'mock_test_attempts';

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const mockTestSessionStore = {
  async create(userId: string, subject: string, questions: GeneratedQuestion[]): Promise<StoredMockTestSession> {
    const db = await getDb();
    const session: StoredMockTestSession = {
      id: newId('test'),
      userId,
      subject,
      questions: questions.map((q) => ({ ...q, id: newId('q') })),
      status: 'in_progress',
      currentQIndex: 0,
      answers: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.collection<StoredMockTestSession>(COLLECTION).insertOne(session);
    return session;
  },

  async get(id: string, userId: string): Promise<StoredMockTestSession | null> {
    const db = await getDb();
    return db.collection<StoredMockTestSession>(COLLECTION).findOne({ id, userId });
  },

  async getActiveAttempt(userId: string): Promise<StoredMockTestSession | null> {
    const db = await getDb();
    return db.collection<StoredMockTestSession>(COLLECTION).findOne(
      { userId, status: 'in_progress' },
      { sort: { updatedAt: -1 } }
    );
  },

  async updateProgress(
    id: string,
    userId: string,
    patch: {
      answers?: Record<string, string>;
      currentQIndex?: number;
      timeRemainingSeconds?: number;
    }
  ): Promise<boolean> {
    const db = await getDb();
    const res = await db.collection<StoredMockTestSession>(COLLECTION).updateOne(
      { id, userId, status: 'in_progress' },
      {
        $set: {
          ...patch,
          updatedAt: Date.now(),
        },
      }
    );
    return res.matchedCount > 0;
  },

  async markSubmitted(id: string, userId: string, resultId: string): Promise<boolean> {
    const db = await getDb();
    const res = await db.collection<StoredMockTestSession>(COLLECTION).updateOne(
      { id, userId },
      {
        $set: {
          status: 'submitted',
          resultId,
          updatedAt: Date.now(),
        },
      }
    );
    return res.matchedCount > 0;
  },

  async abandon(id: string, userId: string): Promise<boolean> {
    const db = await getDb();
    const res = await db.collection<StoredMockTestSession>(COLLECTION).updateOne(
      { id, userId, status: 'in_progress' },
      {
        $set: {
          status: 'abandoned',
          updatedAt: Date.now(),
        },
      }
    );
    return res.matchedCount > 0;
  },
};
