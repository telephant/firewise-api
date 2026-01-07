import { Response } from 'express';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { supabaseAdmin } from '../config/supabase';

export interface Feedback {
  id: string;
  user_id: string | null;
  type: string;
  content: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export type FeedbackType = 'missing_stock' | 'bug_report' | 'feature_request' | 'other';

interface CreateFeedbackBody {
  type: FeedbackType;
  content: Record<string, unknown>;
}

/**
 * Create feedback
 * POST /api/feedback
 */
export const createFeedback = async (
  req: AuthenticatedRequest & { body: CreateFeedbackBody },
  res: Response<ApiResponse<Feedback>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { type, content } = req.body;

    if (!type || !content) {
      res.status(400).json({
        success: false,
        error: 'Type and content are required',
      });
      return;
    }

    const validTypes: FeedbackType[] = ['missing_stock', 'bug_report', 'feature_request', 'other'];
    if (!validTypes.includes(type)) {
      res.status(400).json({
        success: false,
        error: `Invalid feedback type. Must be one of: ${validTypes.join(', ')}`,
      });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .insert({
        user_id: userId,
        type,
        content,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating feedback:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create feedback',
      });
      return;
    }

    res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error creating feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};

/**
 * Get user's feedback
 * GET /api/feedback
 */
export const getUserFeedback = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Feedback[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching feedback:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch feedback',
      });
      return;
    }

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
};
