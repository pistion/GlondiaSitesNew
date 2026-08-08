import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import * as sandboxController from '../controllers/sandboxSimulation.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/services', sandboxController.listServices);
router.post('/simulate', sandboxController.simulate);

export default router;
