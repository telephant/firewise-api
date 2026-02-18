import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { sendChatMessage, getChatExamples } from '../controllers/chat.controller';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/fire/chat/examples - Get example chat messages
router.get('/examples', getChatExamples);

// POST /api/fire/chat - Send a message to the chat agent (router auto-classifies)
router.post('/', sendChatMessage);

export default router;
