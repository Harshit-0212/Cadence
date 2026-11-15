import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { adminJourneyController as ac } from '../controllers/adminJourney.js';

export const adminJourneyRouter = Router();
adminJourneyRouter.use(requireAuth, requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WEBP, SVG) are allowed.'));
    }
  },
});

// Journeys
adminJourneyRouter.get('/journeys', ac.listJourneys);
adminJourneyRouter.post('/journeys', ac.createJourney);
adminJourneyRouter.patch('/journeys/:id', ac.updateJourney);

// Journey Full Graph (Admin)
adminJourneyRouter.get('/journeys/:journeyId/graph', ac.getJourneyGraph);
adminJourneyRouter.put('/journeys/:journeyId/graph', ac.saveJourneyGraph);

// Journey Settings & Background
adminJourneyRouter.get('/journeys/:journeyId/settings', ac.getJourneySettings);
adminJourneyRouter.put('/journeys/:journeyId/settings', ac.saveJourneySettings);
adminJourneyRouter.post('/journeys/:journeyId/background-image', upload.single('image'), ac.uploadBackgroundImage);

// Journey Versioning / History
adminJourneyRouter.get('/journeys/:journeyId/versions', ac.listVersions);
adminJourneyRouter.post('/journeys/:journeyId/versions/:versionId/restore', ac.restoreVersion);

// Stages (admin view by journeyId, not slug)
adminJourneyRouter.get('/journeys/:journeyId/stages', ac.listStages);
adminJourneyRouter.post('/stages', ac.createStage);
adminJourneyRouter.patch('/stages/:id', ac.updateStage);
adminJourneyRouter.delete('/stages/:id', ac.deleteStage);

// Activities (admin view by stageId)
adminJourneyRouter.get('/stages/:stageId/activities', ac.listActivities);
adminJourneyRouter.post('/activities', ac.createActivity);
adminJourneyRouter.patch('/activities/:id', ac.updateActivity);

// Knowledge questions
adminJourneyRouter.get('/stages/:stageId/questions', ac.listQuestions);
adminJourneyRouter.post('/questions', ac.createQuestion);
adminJourneyRouter.patch('/questions/:id', ac.updateQuestion);

// Checkpoint inventory readiness
adminJourneyRouter.get('/stages/:stageId/inventory', ac.checkInventory);

