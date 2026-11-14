import { fetchApi } from './api';

export interface MistakeRecord {
  _id: string;
  userId: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  subject: string;
  topic: string;
  explanation: string;
  resolved: boolean;
  createdAt: string;
}

export interface FlashcardRecord {
  _id: string;
  userId: string;
  front: string;
  back: string;
  subject: string;
  topic?: string;
  interval: number;
  repetition: number;
  easeFactor: number;
  nextReviewDate: string;
}

export interface CalendarEventRecord {
  _id: string;
  userId: string;
  title: string;
  date: string;
  time?: string;
  type: 'session' | 'mock-test' | 'flashcard' | 'interview' | 'deadline' | 'custom';
  completed?: boolean;
}

export interface InterviewReportRecord {
  _id?: string;
  id?: string;
  userId: string;
  role: string;
  mode?: string;
  difficulty?: string;
  topic?: string;
  overallScore: number;
  communicationScore: number;
  technicalDepthScore?: number;
  technicalScore?: number;
  confidenceScore: number;
  strengths: string[];
  weaknesses: Array<{
    area?: string;
    reason?: string;
    fix?: string;
    studyLink?: string;
  }>;
  questions?: Array<{
    question: string;
    userAnswer?: string;
    answer?: string;
    sampleAnswer?: string;
    score: number;
    reason?: string;
  }>;
  createdAt?: string;
}

export const learningFeaturesService = {
  // Mistakes
  async getMistakes(): Promise<MistakeRecord[]> {
    const res = (await fetchApi('/mistakes')) as any;
    return res.data?.mistakes || [];
  },
  async resolveMistake(id: string): Promise<void> {
    await fetchApi(`/mistakes/${id}/resolve`, { method: 'POST' });
  },

  // Flashcards
  async getDueFlashcards(): Promise<FlashcardRecord[]> {
    const res = (await fetchApi('/flashcards/due')) as any;
    return res.data?.cards || [];
  },
  async createFlashcard(card: {
    front: string;
    back: string;
    subject?: string;
    topic?: string;
    sourceDocId?: string;
    sourceMistakeId?: string;
  }): Promise<FlashcardRecord> {
    const res = (await fetchApi('/flashcards', {
      method: 'POST',
      body: JSON.stringify(card),
    })) as any;
    return res.data;
  },
  async getAllFlashcards(): Promise<any[]> {
    const res = (await fetchApi('/flashcards/all')) as any;
    return res.data || [];
  },
  async generateFlashcardsForDocument(payload: {
    documentId: string;
    documentName: string;
    documentContent?: string;
    existingQuestions?: string[];
  }): Promise<{ cards: any[]; created: number; skipped: number }> {
    const res = (await fetchApi('/flashcards/generate-for-document', {
      method: 'POST',
      body: JSON.stringify(payload),
    })) as any;
    return res.data;
  },
  async reviewFlashcard(id: string, rating: number, reviewType?: 'flip' | 'mcq' | 'cloze' | 'type'): Promise<void> {
    await fetchApi(`/flashcards/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating, reviewType }),
    });
  },

  // Calendar
  async getCalendarEvents(from?: string, to?: string): Promise<CalendarEventRecord[]> {
    const query = from && to ? `?from=${from}&to=${to}` : '';
    const res = (await fetchApi(`/calendar${query}`)) as any;
    return res.data?.events || (Array.isArray(res.data) ? res.data : []);
  },
  async createCalendarEvent(event: Partial<CalendarEventRecord>): Promise<CalendarEventRecord> {
    const res = (await fetchApi('/calendar', {
      method: 'POST',
      body: JSON.stringify(event),
    })) as any;
    return res.data?.event || res.data;
  },
  async updateCalendarEvent(id: string, patch: Partial<CalendarEventRecord>): Promise<CalendarEventRecord> {
    const res = (await fetchApi(`/calendar/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })) as any;
    return res.data?.event || res.data;
  },
  async deleteCalendarEvent(id: string): Promise<void> {
    await fetchApi(`/calendar/${id}`, { method: 'DELETE' });
  },

  // Interview Prep
  async evaluateInterview(payload: {
    role: string;
    difficulty?: string;
    mode?: string;
    questions: Array<{ question: string; answer: string }>;
  }): Promise<InterviewReportRecord> {
    const res = (await fetchApi('/interview/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    })) as any;
    return res.data?.report || res.data;
  },
  async getInterviewReports(): Promise<InterviewReportRecord[]> {
    const res = (await fetchApi('/interview/reports')) as any;
    return res.data?.reports || (Array.isArray(res.data) ? res.data : []);
  },
};

