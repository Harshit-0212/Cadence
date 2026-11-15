/**
 * Admin journey controller — CRUD for journeys, stages, activities,
 * and knowledge questions. Enforces draft/review/publish workflow.
 */
import type { Response } from 'express';
import { GridFSBucket, ObjectId } from 'mongodb';
import { getDb } from '../lib/db.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  journeyStore,
  stageStore,
  activityStore,
  knowledgeQuestionStore,
  journeyEdgeStore,
  journeySettingsStore,
  journeySnapshotStore,
  newJourneyId,
  newStageId,
  newEdgeId,
  newActivityId,
  newKnowledgeQuestionId,
  detectCycle,
} from '../lib/journeyStore.js';
import { broadcastEvent } from '../lib/socket.js';
import type {
  StoredJourney,
  StoredStage,
  StoredActivity,
  StoredKnowledgeQuestion,
  StoredJourneyEdge,
  JourneySettings,
} from '../types/journey.js';

export const adminJourneyController = {
  // ── Journeys ───────────────────────────────────────────────────────────────

  async listJourneys(_req: AuthedRequest, res: Response): Promise<void> {
    const journeys = await journeyStore.listAll();
    res.json({ data: journeys });
  },

  async createJourney(req: AuthedRequest, res: Response): Promise<void> {
    const { title, slug, description } = req.body ?? {};
    if (!title || !slug || !description) {
      res.status(400).json({ error: { message: 'title, slug, and description are required.' } });
      return;
    }
    const now = new Date().toISOString();
    const journey: StoredJourney = {
      _id: newJourneyId(),
      slug: slug.trim().toLowerCase(),
      title,
      description,
      stageIds: [],
      milestoneStageIds: [],
      status: 'draft',
      contentVersion: 1,
      createdBy: req.userId!,
      createdAt: now,
      updatedAt: now,
    };
    await journeyStore.create(journey);
    res.status(201).json({ data: journey });
  },

  async updateJourney(req: AuthedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { title, description, stageIds, milestoneStageIds, status } = req.body ?? {};
    const patch: Partial<StoredJourney> = {};
    if (title) patch.title = title;
    if (description) patch.description = description;
    if (stageIds) patch.stageIds = stageIds;
    if (milestoneStageIds) patch.milestoneStageIds = milestoneStageIds;
    if (status) patch.status = status;
    const updated = await journeyStore.update(id, patch);
    if (!updated) { res.status(404).json({ error: { message: 'Journey not found.' } }); return; }
    res.json({ data: updated });
  },

  // ── Stages ─────────────────────────────────────────────────────────────────

  async listStages(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    const stages = await stageStore.listByJourney(journeyId, false);
    res.json({ data: stages });
  },

  async createStage(req: AuthedRequest, res: Response): Promise<void> {
    const {
      journeyId, title, slug, learningGoal, type, prerequisiteStageIds,
      topicTags, checkpoint, previewUnlocked,
    } = req.body ?? {};

    if (!journeyId || !title || !slug) {
      res.status(400).json({ error: { message: 'journeyId, title, and slug are required.' } });
      return;
    }

    const now = new Date().toISOString();
    const stage: StoredStage = {
      _id: newStageId(),
      journeyId,
      slug: slug.trim().toLowerCase(),
      title,
      learningGoal: learningGoal ?? '',
      type: type ?? 'pattern',
      prerequisiteStageIds: prerequisiteStageIds ?? [],
      activityIds: [],
      topicTags: topicTags ?? [],
      checkpoint: {
        minKnowledgeQuestions: checkpoint?.minKnowledgeQuestions ?? 5,
        minCodingTasks: checkpoint?.minCodingTasks ?? 1,
        knowledgePassPercent: checkpoint?.knowledgePassPercent ?? 70,
        codingPassCount: checkpoint?.codingPassCount ?? 1,
        knowledgeQuestionCount: checkpoint?.knowledgeQuestionCount ?? 5,
        codingTaskCount: checkpoint?.codingTaskCount ?? 1,
      },
      previewUnlocked: previewUnlocked ?? false,
      status: 'draft',
      contentVersion: 1,
      createdBy: req.userId!,
      createdAt: now,
      updatedAt: now,
    };

    // Cycle check
    const existingStages = await stageStore.listByJourney(journeyId, false);
    const allForCheck = [...existingStages, stage].map((s) => ({
      _id: s._id,
      prerequisiteStageIds: s.prerequisiteStageIds,
    }));
    const cycle = detectCycle(allForCheck);
    if (cycle) {
      res.status(400).json({ error: { message: `Prerequisite cycle detected: ${cycle}` } });
      return;
    }

    await stageStore.create(stage);

    // Append to journey's stageIds
    const journey = await journeyStore.findById(journeyId);
    if (journey) {
      await journeyStore.update(journeyId, { stageIds: [...journey.stageIds, stage._id] });
    }

    res.status(201).json({ data: stage });
  },

  async updateStage(req: AuthedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const {
      title,
      learningGoal,
      description,
      icon,
      color,
      x,
      y,
      order,
      statusType,
      content,
      prerequisiteStageIds,
      topicTags,
      checkpoint,
      status,
      previewUnlocked,
    } = req.body ?? {};
    const patch: Partial<StoredStage> = {};
    if (title) patch.title = title;
    if (learningGoal !== undefined) patch.learningGoal = learningGoal;
    if (description !== undefined) patch.description = description;
    if (icon !== undefined) patch.icon = icon;
    if (color !== undefined) patch.color = color;
    if (x !== undefined) patch.x = x;
    if (y !== undefined) patch.y = y;
    if (order !== undefined) patch.order = order;
    if (statusType !== undefined) patch.statusType = statusType;
    if (content !== undefined) patch.content = content;
    if (prerequisiteStageIds) patch.prerequisiteStageIds = prerequisiteStageIds;
    if (topicTags) patch.topicTags = topicTags;
    if (checkpoint) patch.checkpoint = checkpoint;
    if (status) patch.status = status;
    if (previewUnlocked !== undefined) patch.previewUnlocked = previewUnlocked;

    const stage = await stageStore.findById(id);
    if (!stage) { res.status(404).json({ error: { message: 'Stage not found.' } }); return; }

    if (prerequisiteStageIds) {
      const allStages = await stageStore.listByJourney(stage.journeyId, false);
      const check = allStages.map((s) => ({
        _id: s._id,
        prerequisiteStageIds: s._id === id ? prerequisiteStageIds : s.prerequisiteStageIds,
      }));
      const cycle = detectCycle(check);
      if (cycle) {
        res.status(400).json({ error: { message: `Prerequisite cycle detected: ${cycle}` } });
        return;
      }
    }

    const updated = await stageStore.update(id, patch);
    if (!updated) { res.status(404).json({ error: { message: 'Stage not found.' } }); return; }
    broadcastEvent('journey:updated', { stageId: id, journeyId: updated.journeyId });
    res.json({ data: updated });
  },

  async deleteStage(req: AuthedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const stage = await stageStore.findById(id);
    if (!stage) {
      res.status(404).json({ error: { message: 'Stage not found.' } });
      return;
    }
    const journeyId = stage.journeyId;
    await stageStore.delete(id);
    await journeyEdgeStore.deleteByStageId(journeyId, id);

    const journey = await journeyStore.findById(journeyId);
    if (journey) {
      await journeyStore.update(journeyId, {
        stageIds: journey.stageIds.filter((sid) => sid !== id),
        milestoneStageIds: journey.milestoneStageIds.filter((sid) => sid !== id),
      });
    }
    broadcastEvent('journey:updated', { journeyId, deletedStageId: id });
    res.json({ data: { success: true } });
  },

  // ── Graph full load & save ────────────────────────────────────────────────

  async getJourneyGraph(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    const journey = await journeyStore.findById(journeyId);
    if (!journey) {
      res.status(404).json({ error: { message: 'Journey not found.' } });
      return;
    }
    const stages = await stageStore.listByJourney(journeyId, false);
    const edges = await journeyEdgeStore.listByJourney(journeyId);
    const settings = await journeySettingsStore.getByJourney(journeyId);
    res.json({
      data: {
        journey,
        stages,
        edges,
        settings,
      },
    });
  },

  async saveJourneyGraph(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    const { stages, edges, settings, description } = req.body ?? {};

    const journey = await journeyStore.findById(journeyId);
    if (!journey) {
      res.status(404).json({ error: { message: 'Journey not found.' } });
      return;
    }

    const userId = req.userId!;
    const now = new Date().toISOString();

    // 1. Process stages
    const preparedStages: StoredStage[] = (stages || []).map((s: Partial<StoredStage>, idx: number) => {
      const stageId = s._id || newStageId();
      return {
        _id: stageId,
        journeyId,
        slug: s.slug || `stage-${idx + 1}-${Date.now().toString(36)}`,
        title: s.title || `Stage ${idx + 1}`,
        learningGoal: s.learningGoal || s.description || '',
        description: s.description || s.learningGoal || '',
        icon: s.icon || 'book-open',
        color: s.color || '#6542C5',
        x: typeof s.x === 'number' ? s.x : 100 + idx * 250,
        y: typeof s.y === 'number' ? s.y : 180,
        order: typeof s.order === 'number' ? s.order : idx + 1,
        statusType: s.statusType || (s.type === 'milestone' ? 'milestone' : 'practice'),
        content: s.content || {},
        type: s.type || 'pattern',
        prerequisiteStageIds: s.prerequisiteStageIds || [],
        activityIds: s.activityIds || [],
        checkpoint: s.checkpoint || {
          minKnowledgeQuestions: 2,
          minCodingTasks: 0,
          knowledgePassPercent: 70,
          codingPassCount: 0,
          knowledgeQuestionCount: 2,
          codingTaskCount: 0,
        },
        topicTags: s.topicTags || [],
        status: s.status || 'published',
        contentVersion: (s.contentVersion || 1) + 1,
        previewUnlocked: Boolean(s.previewUnlocked),
        createdBy: s.createdBy || userId,
        createdAt: s.createdAt || now,
        updatedAt: now,
      };
    });

    // 2. Validate cycle on stages
    const cycle = detectCycle(preparedStages.map((s) => ({ _id: s._id, prerequisiteStageIds: s.prerequisiteStageIds })));
    if (cycle) {
      res.status(400).json({ error: { message: `Prerequisite cycle detected: ${cycle}` } });
      return;
    }

    // 3. Process edges
    const preparedEdges: StoredJourneyEdge[] = (edges || []).map((e: Partial<StoredJourneyEdge>) => ({
      _id: e._id || newEdgeId(),
      journeyId,
      fromStageId: e.fromStageId!,
      toStageId: e.toStageId!,
      style: e.style || 'curve',
      color: e.color || '#6542C5',
      animated: e.animated !== undefined ? Boolean(e.animated) : true,
      createdAt: e.createdAt || now,
      updatedAt: now,
    }));

    // 4. Update stages and edges in DB
    await stageStore.replaceManyForJourney(journeyId, preparedStages);
    await journeyEdgeStore.replaceManyForJourney(journeyId, preparedEdges);

    // 5. Update settings
    let savedSettings: JourneySettings;
    if (settings) {
      savedSettings = await journeySettingsStore.save(journeyId, settings, userId);
    } else {
      savedSettings = await journeySettingsStore.getByJourney(journeyId);
    }

    // 6. Update journey document
    const stageIds = preparedStages.map((s) => s._id);
    const milestoneStageIds = preparedStages.filter((s) => s.type === 'milestone').map((s) => s._id);
    await journeyStore.update(journeyId, {
      stageIds,
      milestoneStageIds,
      updatedAt: now,
    });

    // 7. Save version snapshot
    await journeySnapshotStore.createSnapshot(
      journeyId,
      preparedStages,
      preparedEdges,
      savedSettings,
      userId,
      description || `Saved ${preparedStages.length} stages and ${preparedEdges.length} connections`,
    );

    // 8. Real-time broadcast
    broadcastEvent('journey:updated', { journeyId });

    res.json({
      data: {
        stages: preparedStages,
        edges: preparedEdges,
        settings: savedSettings,
      },
    });
  },

  // ── Settings & Background ──────────────────────────────────────────────────

  async getJourneySettings(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    const settings = await journeySettingsStore.getByJourney(journeyId);
    res.json({ data: settings });
  },

  async saveJourneySettings(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    const userId = req.userId!;
    const settings = await journeySettingsStore.save(journeyId, req.body ?? {}, userId);
    broadcastEvent('journey:updated', { journeyId, settings });
    res.json({ data: settings });
  },

  async uploadBackgroundImage(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    if (!req.file) {
      res.status(400).json({ error: { message: 'No file uploaded.' } });
      return;
    }

    const db = await getDb();
    const bucket = new GridFSBucket(db, { bucketName: 'journey_assets' });
    const filename = `bg_${journeyId}_${Date.now()}_${req.file.originalname}`;
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: { journeyId, uploadedBy: req.userId, contentType: req.file.mimetype },
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on('finish', async () => {
      const fileId = uploadStream.id.toString();
      const imageUrl = `/api/learn/assets/${fileId}`;
      const settings = await journeySettingsStore.save(
        journeyId,
        {
          backgroundType: 'uploaded',
          uploadedImageId: fileId,
          uploadedImageUrl: imageUrl,
        },
        req.userId!,
      );
      broadcastEvent('journey:updated', { journeyId, settings });
      res.json({
        data: {
          fileId,
          imageUrl,
          settings,
        },
      });
    });

    uploadStream.on('error', (err) => {
      res.status(500).json({ error: { message: 'Image upload failed: ' + err.message } });
    });
  },

  // ── Versioning ────────────────────────────────────────────────────────────

  async listVersions(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId } = req.params;
    const versions = await journeySnapshotStore.listSnapshots(journeyId);
    res.json({ data: versions });
  },

  async restoreVersion(req: AuthedRequest, res: Response): Promise<void> {
    const { journeyId, versionId } = req.params;
    const snapshot = await journeySnapshotStore.getSnapshot(journeyId, versionId);
    if (!snapshot) {
      res.status(404).json({ error: { message: 'Version snapshot not found.' } });
      return;
    }

    const userId = req.userId!;
    const now = new Date().toISOString();

    await stageStore.replaceManyForJourney(journeyId, snapshot.stages);
    await journeyEdgeStore.replaceManyForJourney(journeyId, snapshot.edges);
    await journeySettingsStore.save(journeyId, snapshot.settings, userId);

    const stageIds = snapshot.stages.map((s) => s._id);
    const milestoneStageIds = snapshot.stages.filter((s) => s.type === 'milestone').map((s) => s._id);
    await journeyStore.update(journeyId, {
      stageIds,
      milestoneStageIds,
      updatedAt: now,
    });

    // Create a new snapshot capturing this restore event
    await journeySnapshotStore.createSnapshot(
      journeyId,
      snapshot.stages,
      snapshot.edges,
      snapshot.settings,
      userId,
      `Restored from version ${snapshot.version}`,
    );

    broadcastEvent('journey:updated', { journeyId });

    res.json({
      data: {
        stages: snapshot.stages,
        edges: snapshot.edges,
        settings: snapshot.settings,
        restoredVersion: snapshot.version,
      },
    });
  },

  // ── Activities ─────────────────────────────────────────────────────────────

  async listActivities(req: AuthedRequest, res: Response): Promise<void> {
    const { stageId } = req.params;
    const activities = await activityStore.listByStage(stageId, false);
    res.json({ data: activities });
  },

  async createActivity(req: AuthedRequest, res: Response): Promise<void> {
    const {
      stageId, journeyId, title, type, lessonContent, comprehensionContent,
      codingProblemId, isRequired, order,
    } = req.body ?? {};

    if (!stageId || !journeyId || !title || !type) {
      res.status(400).json({ error: { message: 'stageId, journeyId, title, and type are required.' } });
      return;
    }

    const now = new Date().toISOString();
    const activity: StoredActivity = {
      _id: newActivityId(),
      stageId,
      journeyId,
      title,
      type,
      lessonContent,
      comprehensionContent,
      codingProblemId,
      isRequired: isRequired ?? true,
      order: order ?? 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await activityStore.create(activity);

    // Append to stage's activityIds
    const stage = await stageStore.findById(stageId);
    if (stage) {
      await stageStore.update(stageId, { activityIds: [...stage.activityIds, activity._id] });
    }

    res.status(201).json({ data: activity });
  },

  async updateActivity(req: AuthedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { title, lessonContent, comprehensionContent, codingProblemId, isRequired, order, status } = req.body ?? {};
    const patch: Partial<StoredActivity> = {};
    if (title) patch.title = title;
    if (lessonContent !== undefined) patch.lessonContent = lessonContent;
    if (comprehensionContent !== undefined) patch.comprehensionContent = comprehensionContent;
    if (codingProblemId !== undefined) patch.codingProblemId = codingProblemId;
    if (isRequired !== undefined) patch.isRequired = isRequired;
    if (order !== undefined) patch.order = order;
    if (status) patch.status = status;
    const updated = await activityStore.update(id, patch);
    if (!updated) { res.status(404).json({ error: { message: 'Activity not found.' } }); return; }
    res.json({ data: updated });
  },

  // ── Knowledge questions ───────────────────────────────────────────────────

  async listQuestions(req: AuthedRequest, res: Response): Promise<void> {
    const { stageId } = req.params;
    const questions = await knowledgeQuestionStore.listByStage(stageId);
    res.json({ data: questions });
  },

  async createQuestion(req: AuthedRequest, res: Response): Promise<void> {
    const { stageId, journeyId, type, prompt, options, correctOptionId, explanation, difficulty, conceptTags } = req.body ?? {};

    if (!stageId || !journeyId || !type || !prompt || !options || !correctOptionId || !explanation) {
      res.status(400).json({ error: { message: 'stageId, journeyId, type, prompt, options, correctOptionId, and explanation are required.' } });
      return;
    }

    // Validate correctOptionId references a real option
    if (!options.find((o: { id: string }) => o.id === correctOptionId)) {
      res.status(400).json({ error: { message: 'correctOptionId must match an option id.' } });
      return;
    }

    const now = new Date().toISOString();
    const question: StoredKnowledgeQuestion = {
      _id: newKnowledgeQuestionId(),
      stageId,
      journeyId,
      type,
      prompt,
      options,
      correctOptionId,
      explanation,
      difficulty: difficulty ?? 'medium',
      conceptTags: conceptTags ?? [],
      status: 'draft',
      createdBy: req.userId!,
      createdAt: now,
      updatedAt: now,
    };
    await knowledgeQuestionStore.create(question);
    res.status(201).json({ data: question });
  },

  async updateQuestion(req: AuthedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { prompt, options, correctOptionId, explanation, difficulty, conceptTags, status } = req.body ?? {};
    const patch: Partial<StoredKnowledgeQuestion> = {};
    if (prompt) patch.prompt = prompt;
    if (options) patch.options = options;
    if (correctOptionId) patch.correctOptionId = correctOptionId;
    if (explanation) patch.explanation = explanation;
    if (difficulty) patch.difficulty = difficulty;
    if (conceptTags) patch.conceptTags = conceptTags;
    if (status) patch.status = status;
    const updated = await knowledgeQuestionStore.update(id, patch);
    if (!updated) { res.status(404).json({ error: { message: 'Question not found.' } }); return; }
    res.json({ data: updated });
  },

  // ── Checkpoint inventory check ────────────────────────────────────────────

  async checkInventory(req: AuthedRequest, res: Response): Promise<void> {
    const { stageId } = req.params;
    const stage = await stageStore.findById(stageId);
    if (!stage) { res.status(404).json({ error: { message: 'Stage not found.' } }); return; }

    const approvedCount = await knowledgeQuestionStore.countApprovedByStage(stageId);
    const activities = await activityStore.listByStage(stageId, false);
    const codingCount = activities.filter((a) => a.type === 'coding_practice' && a.codingProblemId).length;

    const { minKnowledgeQuestions, minCodingTasks } = stage.checkpoint;
    const ready = approvedCount >= minKnowledgeQuestions && codingCount >= minCodingTasks;

    res.json({
      data: {
        ready,
        approvedKnowledgeQuestions: approvedCount,
        requiredKnowledgeQuestions: minKnowledgeQuestions,
        codingTasksAvailable: codingCount,
        requiredCodingTasks: minCodingTasks,
        issues: [
          ...( approvedCount < minKnowledgeQuestions ? [`Needs ${minKnowledgeQuestions - approvedCount} more approved knowledge questions.`] : []),
          ...( codingCount < minCodingTasks ? [`Needs ${minCodingTasks - codingCount} more coding practice activities.`] : []),
        ],
      },
    });
  },
};

