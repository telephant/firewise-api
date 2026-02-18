import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';

// Agent service URL
const AGENT_URL = process.env.RUNWAY_AGENT_URL || 'http://localhost:8000';

// Types matching agent service schemas (Router Agent)
interface ChatRequest {
  message: string;
  conversation_id?: string;
}

interface ExecutedAction {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  success: boolean;
}

interface ChatResponse {
  message: string;
  conversation_id: string | null;
  sub_type: string | null;
  action: string | null;
  task_completed: boolean;
  executed_actions: ExecutedAction[];
  error?: string;
}

// Chat examples for user reference
const CHAT_EXAMPLES = [
  'Buy 10 shares of AAPL for $1500',
  'I got paid $3500 salary today',
  'Received $50 dividend from MSFT',
  'Transfer $1000 from checking to savings',
  'Add new mortgage: $500k at 6.5% for 30 years',
  'Pay $2000 to my mortgage',
];

/**
 * Get chat examples
 * GET /api/fire/chat/examples
 */
export const getChatExamples = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<typeof CHAT_EXAMPLES>>
): Promise<void> => {
  res.json({ success: true, data: CHAT_EXAMPLES });
};


/**
 * Send a chat message to the AI agent
 * POST /api/fire/chat
 *
 * The router agent automatically classifies the user's intent.
 * No menu selection needed - just send natural language.
 */
export const sendChatMessage = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ChatResponse>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { message, conversation_id } = req.body as ChatRequest;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'Message is required' });
      return;
    }

    // Get auth token from request header to forward to agent
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';

    // Build API base URL for agent to call back
    const protocol = req.protocol;
    const host = req.get('host');
    const apiBaseUrl = `${protocol}://${host}/api`;

    // Call agent service (router agent auto-classifies)
    const agentResponse = await callChatAgent({
      message,
      user_id: userId,
      conversation_id,
      auth_token: authToken,
      api_base_url: apiBaseUrl,
    });

    res.json({
      success: true,
      data: agentResponse,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in sendChatMessage:', err);
    res.status(500).json({ success: false, error: 'Failed to process chat message' });
  }
};

/**
 * Call the chat agent service (router agent)
 */
async function callChatAgent(request: {
  message: string;
  user_id: string;
  conversation_id?: string;
  auth_token: string;
  api_base_url: string;
}): Promise<ChatResponse> {
  const agentUrl = `${AGENT_URL}/chat/`;

  try {
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Chat agent service error:', errorText);
      throw new AppError(`Chat agent error: ${response.status}`, 500);
    }

    return await response.json() as ChatResponse;
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Failed to call chat agent service:', err);
    throw new AppError('Failed to connect to chat agent service', 500);
  }
}
