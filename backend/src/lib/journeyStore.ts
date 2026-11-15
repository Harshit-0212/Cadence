/**
 * journeyStore.ts — MongoDB persistence for learning journeys, stages,
 * activities, knowledge questions, checkpoint attempts, and student progress.
 *
 * All collections use the same lazy-singleton pattern as the rest of the codebase.
 */
import { getDb } from './db.js';
import type {
  StoredJourney,
  StoredStage,
  StoredActivity,
  StoredKnowledgeQuestion,
  StoredCheckpointAttempt,
  StoredStudentJourneyProgress,
  StoredJourneyEdge,
  StoredJourneySettingsDoc,
  StoredJourneyVersionSnapshot,
  JourneySettings,
  StageProgressState,
  ActivityCompletion,
  KnowledgeQuestionStatus,
  AttemptStatus,
} from '../types/journey.js';

// ─── Collection helpers ───────────────────────────────────────────────────────

async function journeysCol() {
  const db = await getDb();
  const col = db.collection<StoredJourney>('journey_journeys');
  await col.createIndex({ slug: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ status: 1 }).catch(() => {});
  return col;
}

async function stagesCol() {
  const db = await getDb();
  const col = db.collection<StoredStage>('journey_stages');
  await col.createIndex({ journeyId: 1 }).catch(() => {});
  await col.createIndex({ slug: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ status: 1, journeyId: 1 }).catch(() => {});
  return col;
}

async function activitiesCol() {
  const db = await getDb();
  const col = db.collection<StoredActivity>('journey_activities');
  await col.createIndex({ stageId: 1, order: 1 }).catch(() => {});
  await col.createIndex({ journeyId: 1 }).catch(() => {});
  return col;
}

async function knowledgeQuestionsCol() {
  const db = await getDb();
  const col = db.collection<StoredKnowledgeQuestion>('journey_knowledge_questions');
  await col.createIndex({ stageId: 1, status: 1, difficulty: 1 }).catch(() => {});
  await col.createIndex({ journeyId: 1 }).catch(() => {});
  return col;
}

async function checkpointAttemptsCol() {
  const db = await getDb();
  const col = db.collection<StoredCheckpointAttempt>('journey_checkpoint_attempts');
  await col.createIndex({ userId: 1, stageId: 1 }).catch(() => {});
  await col.createIndex({ userId: 1, journeyId: 1 }).catch(() => {});
  return col;
}

async function studentProgressCol() {
  const db = await getDb();
  const col = db.collection<StoredStudentJourneyProgress>('journey_student_progress');
  await col.createIndex({ userId: 1, journeyId: 1 }, { unique: true }).catch(() => {});
  return col;
}

async function edgesCol() {
  const db = await getDb();
  const col = db.collection<StoredJourneyEdge>('journey_edges');
  await col.createIndex({ journeyId: 1 }).catch(() => {});
  await col.createIndex({ fromStageId: 1, toStageId: 1 }).catch(() => {});
  return col;
}

async function settingsCol() {
  const db = await getDb();
  const col = db.collection<StoredJourneySettingsDoc>('journey_settings');
  await col.createIndex({ journeyId: 1 }, { unique: true }).catch(() => {});
  return col;
}

async function snapshotsCol() {
  const db = await getDb();
  const col = db.collection<StoredJourneyVersionSnapshot>('journey_snapshots');
  await col.createIndex({ journeyId: 1, version: -1 }).catch(() => {});
  return col;
}

// ─── ID generators ────────────────────────────────────────────────────────────

const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const newJourneyId = () => uid('journey');
export const newStageId = () => uid('stage');
export const newEdgeId = () => uid('edge');
export const newSnapshotId = () => uid('snap');
export const newActivityId = () => uid('act');
export const newKnowledgeQuestionId = () => uid('kq');
export const newAttemptId = () => uid('attempt');
export const newProgressId = () => uid('jp');

// ─── Journey store ────────────────────────────────────────────────────────────

export const journeyStore = {
  async listPublished(): Promise<StoredJourney[]> {
    const col = await journeysCol();
    return col.find({ status: 'published' }).sort({ updatedAt: -1 }).toArray();
  },

  async listAll(): Promise<StoredJourney[]> {
    const col = await journeysCol();
    return col.find({}).sort({ updatedAt: -1 }).toArray();
  },

  async findById(id: string): Promise<StoredJourney | null> {
    const col = await journeysCol();
    return col.findOne({ _id: id });
  },

  async findBySlug(slug: string): Promise<StoredJourney | null> {
    const col = await journeysCol();
    return col.findOne({ slug });
  },

  async create(journey: StoredJourney): Promise<StoredJourney> {
    const col = await journeysCol();
    await col.insertOne(journey);
    return journey;
  },

  async update(id: string, patch: Partial<StoredJourney>): Promise<StoredJourney | null> {
    const col = await journeysCol();
    const res = await col.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    return res ?? null;
  },
};

// ─── Stage store ──────────────────────────────────────────────────────────────

export const stageStore = {
  async listByJourney(journeyId: string, onlyPublished = true): Promise<StoredStage[]> {
    const col = await stagesCol();
    const q: Record<string, unknown> = { journeyId };
    if (onlyPublished) q.status = 'published';
    return col.find(q).toArray();
  },

  async findById(id: string): Promise<StoredStage | null> {
    const col = await stagesCol();
    return col.findOne({ _id: id });
  },

  async findBySlug(slug: string): Promise<StoredStage | null> {
    const col = await stagesCol();
    return col.findOne({ slug });
  },

  async create(stage: StoredStage): Promise<StoredStage> {
    const col = await stagesCol();
    await col.insertOne(stage);
    return stage;
  },

  async update(id: string, patch: Partial<StoredStage>): Promise<StoredStage | null> {
    const col = await stagesCol();
    const res = await col.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    return res ?? null;
  },

  async findManyById(ids: string[]): Promise<StoredStage[]> {
    if (ids.length === 0) return [];
    const col = await stagesCol();
    return col.find({ _id: { $in: ids } }).toArray();
  },

  async delete(id: string): Promise<boolean> {
    const col = await stagesCol();
    const res = await col.deleteOne({ _id: id });
    return res.deletedCount > 0;
  },

  async replaceManyForJourney(journeyId: string, stages: StoredStage[]): Promise<void> {
    const col = await stagesCol();
    await col.deleteMany({ journeyId });
    if (stages.length > 0) {
      await col.insertMany(stages);
    }
  },
};

// ─── Journey Edges store ──────────────────────────────────────────────────────

export const journeyEdgeStore = {
  async listByJourney(journeyId: string): Promise<StoredJourneyEdge[]> {
    const col = await edgesCol();
    return col.find({ journeyId }).toArray();
  },

  async replaceManyForJourney(journeyId: string, edges: StoredJourneyEdge[]): Promise<void> {
    const col = await edgesCol();
    await col.deleteMany({ journeyId });
    if (edges.length > 0) {
      await col.insertMany(edges);
    }
  },

  async deleteByStageId(journeyId: string, stageId: string): Promise<void> {
    const col = await edgesCol();
    await col.deleteMany({
      journeyId,
      $or: [{ fromStageId: stageId }, { toStageId: stageId }],
    });
  },
};

// ─── Journey Settings store ───────────────────────────────────────────────────

const DEFAULT_SETTINGS: JourneySettings = {
  backgroundType: 'gradient',
  gradient: {
    from: '#0f172a',
    to: '#1e1b4b',
    angle: 135,
  },
  themeColors: {
    primary: '#6542C5',
    secondary: '#8B5CF6',
    accent: '#10B981',
    canvasBg: '#0b0f19',
  },
  overlayOpacity: 0.85,
  updatedBy: 'system',
  updatedAt: new Date().toISOString(),
};

export const journeySettingsStore = {
  async getByJourney(journeyId: string): Promise<JourneySettings> {
    const col = await settingsCol();
    const doc = await col.findOne({ journeyId });
    if (!doc) {
      return { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() };
    }
    const { _id, journeyId: jId, ...settings } = doc;
    return settings;
  },

  async save(journeyId: string, settings: Partial<JourneySettings>, userId: string): Promise<JourneySettings> {
    const col = await settingsCol();
    const current = await this.getByJourney(journeyId);
    const updated: JourneySettings = {
      ...current,
      ...settings,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    };
    await col.updateOne(
      { journeyId },
      { $set: { ...updated, journeyId } },
      { upsert: true },
    );
    return updated;
  },
};

// ─── Journey Snapshots / Versioning store ──────────────────────────────────────

export const journeySnapshotStore = {
  async createSnapshot(
    journeyId: string,
    stages: StoredStage[],
    edges: StoredJourneyEdge[],
    settings: JourneySettings,
    userId: string,
    description?: string,
  ): Promise<StoredJourneyVersionSnapshot> {
    const col = await snapshotsCol();
    const latest = await col.findOne({ journeyId }, { sort: { version: -1 } });
    const nextVersion = (latest?.version ?? 0) + 1;
    const snap: StoredJourneyVersionSnapshot = {
      _id: newSnapshotId(),
      journeyId,
      version: nextVersion,
      stages,
      edges,
      settings,
      savedBy: userId,
      savedAt: new Date().toISOString(),
      description,
    };
    await col.insertOne(snap);

    // Keep only last 10 snapshots per journey
    const all = await col.find({ journeyId }).sort({ version: -1 }).toArray();
    if (all.length > 10) {
      const toRemove = all.slice(10).map((s) => s._id);
      await col.deleteMany({ _id: { $in: toRemove } });
    }

    return snap;
  },

  async listSnapshots(journeyId: string): Promise<{ _id: string; version: number; savedBy: string; savedAt: string; description?: string }[]> {
    const col = await snapshotsCol();
    const snaps = await col
      .find({ journeyId }, { projection: { _id: 1, version: 1, savedBy: 1, savedAt: 1, description: 1 } })
      .sort({ version: -1 })
      .toArray();
    return snaps.map((s) => ({
      _id: s._id,
      version: s.version,
      savedBy: s.savedBy,
      savedAt: s.savedAt,
      description: s.description,
    }));
  },

  async getSnapshot(journeyId: string, versionIdOrNumber: string | number): Promise<StoredJourneyVersionSnapshot | null> {
    const col = await snapshotsCol();
    if (typeof versionIdOrNumber === 'number') {
      return col.findOne({ journeyId, version: versionIdOrNumber });
    }
    return col.findOne({ journeyId, _id: versionIdOrNumber });
  },
};

// ─── Activity store ───────────────────────────────────────────────────────────

export const activityStore = {
  async listByStage(stageId: string, onlyPublished = true): Promise<StoredActivity[]> {
    const col = await activitiesCol();
    const q: Record<string, unknown> = { stageId };
    if (onlyPublished) q.status = 'published';
    return col.find(q).sort({ order: 1 }).toArray();
  },

  async findById(id: string): Promise<StoredActivity | null> {
    const col = await activitiesCol();
    return col.findOne({ _id: id });
  },

  async create(activity: StoredActivity): Promise<StoredActivity> {
    const col = await activitiesCol();
    await col.insertOne(activity);
    return activity;
  },

  async update(id: string, patch: Partial<StoredActivity>): Promise<StoredActivity | null> {
    const col = await activitiesCol();
    const res = await col.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    return res ?? null;
  },

  async listByJourney(journeyId: string): Promise<StoredActivity[]> {
    const col = await activitiesCol();
    return col.find({ journeyId }).sort({ order: 1 }).toArray();
  },
};

// ─── Knowledge question store ─────────────────────────────────────────────────

export const knowledgeQuestionStore = {
  async listByStage(
    stageId: string,
    status?: KnowledgeQuestionStatus,
  ): Promise<StoredKnowledgeQuestion[]> {
    const col = await knowledgeQuestionsCol();
    const q: Record<string, unknown> = { stageId };
    if (status) q.status = status;
    return col.find(q).toArray();
  },

  async countApprovedByStage(stageId: string): Promise<number> {
    const col = await knowledgeQuestionsCol();
    return col.countDocuments({ stageId, status: 'approved' });
  },

  async findById(id: string): Promise<StoredKnowledgeQuestion | null> {
    const col = await knowledgeQuestionsCol();
    return col.findOne({ _id: id });
  },

  async create(q: StoredKnowledgeQuestion): Promise<StoredKnowledgeQuestion> {
    const col = await knowledgeQuestionsCol();
    await col.insertOne(q);
    return q;
  },

  async update(
    id: string,
    patch: Partial<StoredKnowledgeQuestion>,
  ): Promise<StoredKnowledgeQuestion | null> {
    const col = await knowledgeQuestionsCol();
    const res = await col.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    return res ?? null;
  },

  /**
   * Draw a reproducible random sample of approved questions for a checkpoint.
   * Balances difficulty: roughly equal easy/medium/hard where inventory allows.
   */
  async sampleForCheckpoint(
    stageId: string,
    count: number,
  ): Promise<StoredKnowledgeQuestion[]> {
    const col = await knowledgeQuestionsCol();
    const all = await col.find({ stageId, status: 'approved' }).toArray();
    if (all.length < count) return all; // caller checks sufficiency
    // Shuffle deterministically-enough for sessions (not crypto)
    const shuffled = all.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  },
};

// ─── Checkpoint attempt store ─────────────────────────────────────────────────

export const checkpointAttemptStore = {
  async findActiveAttempt(
    userId: string,
    stageId: string,
  ): Promise<StoredCheckpointAttempt | null> {
    const col = await checkpointAttemptsCol();
    return col.findOne({ userId, stageId, status: 'in_progress' });
  },

  async findById(id: string): Promise<StoredCheckpointAttempt | null> {
    const col = await checkpointAttemptsCol();
    return col.findOne({ _id: id });
  },

  async listByUserStage(userId: string, stageId: string): Promise<StoredCheckpointAttempt[]> {
    const col = await checkpointAttemptsCol();
    return col
      .find({ userId, stageId })
      .sort({ startedAt: 1 })
      .toArray();
  },

  async countAttempts(userId: string, stageId: string): Promise<number> {
    const col = await checkpointAttemptsCol();
    return col.countDocuments({ userId, stageId });
  },

  async create(attempt: StoredCheckpointAttempt): Promise<StoredCheckpointAttempt> {
    const col = await checkpointAttemptsCol();
    await col.insertOne(attempt);
    return attempt;
  },

  async update(
    id: string,
    patch: Partial<StoredCheckpointAttempt>,
  ): Promise<StoredCheckpointAttempt | null> {
    const col = await checkpointAttemptsCol();
    const res = await col.findOneAndUpdate(
      { _id: id },
      { $set: patch },
      { returnDocument: 'after' },
    );
    return res ?? null;
  },

  /** Safe idempotent save of in-progress answers (never finalizes) */
  async saveAnswers(
    id: string,
    knowledgeAnswers: Record<string, string>,
  ): Promise<void> {
    const col = await checkpointAttemptsCol();
    await col.updateOne(
      { _id: id, status: 'in_progress' },
      { $set: { knowledgeAnswers } },
    );
  },
};

// ─── Student progress store ───────────────────────────────────────────────────

export const studentProgressStore = {
  async findOrCreate(
    userId: string,
    journeyId: string,
    initialStageState: StageProgressState,
    firstStageId: string,
  ): Promise<StoredStudentJourneyProgress> {
    const col = await studentProgressCol();
    const existing = await col.findOne({ userId, journeyId });
    if (existing) return existing;

    const now = new Date().toISOString();
    const record: StoredStudentJourneyProgress = {
      _id: newProgressId(),
      userId,
      journeyId,
      stageStates: { [firstStageId]: initialStageState },
      completedActivities: [],
      solvedCodingProblems: {},
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await col.insertOne(record);
    return record;
  },

  async findByUserJourney(
    userId: string,
    journeyId: string,
  ): Promise<StoredStudentJourneyProgress | null> {
    const col = await studentProgressCol();
    return col.findOne({ userId, journeyId });
  },

  async updateStageStates(
    userId: string,
    journeyId: string,
    stageStates: Record<string, StageProgressState>,
  ): Promise<void> {
    const col = await studentProgressCol();
    const now = new Date().toISOString();
    await col.updateOne(
      { userId, journeyId },
      { $set: { stageStates, lastActiveAt: now, updatedAt: now } },
      { upsert: false },
    );
  },

  async recordActivityCompletion(
    userId: string,
    journeyId: string,
    activityId: string,
  ): Promise<void> {
    const col = await studentProgressCol();
    const now = new Date().toISOString();
    const completion: ActivityCompletion = { activityId, completedAt: now };
    await col.updateOne(
      { userId, journeyId, 'completedActivities.activityId': { $ne: activityId } },
      {
        $push: { completedActivities: completion },
        $set: { lastActiveAt: now, updatedAt: now },
      },
    );
  },

  async recordCodingSolve(
    userId: string,
    journeyId: string,
    codingProblemId: string,
    verdict: string,
  ): Promise<void> {
    const col = await studentProgressCol();
    const now = new Date().toISOString();
    await col.updateOne(
      { userId, journeyId },
      {
        $set: {
          [`solvedCodingProblems.${codingProblemId}`]: { solvedAt: now, verdict },
          lastActiveAt: now,
          updatedAt: now,
        },
      },
    );
  },
};

// ─── Prerequisite / unlock logic ──────────────────────────────────────────────

/**
 * Recomputes stage states for a student from their attempt history.
 * Called server-side after every checkpoint submission; result is persisted.
 * Client cannot forge unlocks.
 */
export async function recomputeStageStates(
  userId: string,
  journeyId: string,
  stages: StoredStage[],
): Promise<Record<string, StageProgressState>> {
  const attemptHistory = await checkpointAttemptsCol().then((col) =>
    col.find({ userId, journeyId, status: 'graded' }).toArray(),
  );

  // Build a set of passed stage IDs
  const passedStageIds = new Set<string>();
  for (const attempt of attemptHistory) {
    if (attempt.verdict === 'pass') {
      passedStageIds.add(attempt.stageId);
    }
  }

  // Build a set of stages with at least one graded (failed) attempt
  const failedStageIds = new Set<string>();
  for (const attempt of attemptHistory) {
    if (attempt.verdict === 'fail') {
      failedStageIds.add(attempt.stageId);
    }
  }

  // Compute derived states
  const states: Record<string, StageProgressState> = {};

  for (const stage of stages) {
    if (passedStageIds.has(stage._id)) {
      states[stage._id] = 'passed';
      continue;
    }

    const prereqsMet = stage.prerequisiteStageIds.every((pid) => passedStageIds.has(pid));

    if (!prereqsMet) {
      states[stage._id] = 'locked';
    } else if (failedStageIds.has(stage._id)) {
      states[stage._id] = 'needs_review';
    } else {
      states[stage._id] = 'available';
    }
  }

  return states;
}

/**
 * Validate that a prerequisite graph has no cycles.
 * Uses DFS with three-color marking.
 * Returns null if valid, or the cycle path as a string if invalid.
 */
export function detectCycle(
  stages: Pick<StoredStage, '_id' | 'prerequisiteStageIds'>[],
): string | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  for (const s of stages) color[s._id] = WHITE;

  const adj: Record<string, string[]> = {};
  for (const s of stages) adj[s._id] = s.prerequisiteStageIds;

  const path: string[] = [];

  function dfs(id: string): boolean {
    color[id] = GRAY;
    path.push(id);
    for (const dep of adj[id] ?? []) {
      if (color[dep] === GRAY) return true; // cycle
      if (color[dep] === WHITE && dfs(dep)) return true;
    }
    path.pop();
    color[id] = BLACK;
    return false;
  }

  for (const s of stages) {
    if (color[s._id] === WHITE && dfs(s._id)) return path.join(' → ');
  }
  return null;
}

