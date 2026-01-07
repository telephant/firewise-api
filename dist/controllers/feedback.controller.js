"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserFeedback = exports.createFeedback = void 0;
const supabase_1 = require("../config/supabase");
/**
 * Create feedback
 * POST /api/feedback
 */
const createFeedback = async (req, res) => {
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
        const validTypes = ['missing_stock', 'bug_report', 'feature_request', 'other'];
        if (!validTypes.includes(type)) {
            res.status(400).json({
                success: false,
                error: `Invalid feedback type. Must be one of: ${validTypes.join(', ')}`,
            });
            return;
        }
        const { data, error } = await supabase_1.supabaseAdmin
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
    }
    catch (error) {
        console.error('Error creating feedback:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
};
exports.createFeedback = createFeedback;
/**
 * Get user's feedback
 * GET /api/feedback
 */
const getUserFeedback = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({
                success: false,
                error: 'Unauthorized',
            });
            return;
        }
        const { data, error } = await supabase_1.supabaseAdmin
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
    }
    catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
        });
    }
};
exports.getUserFeedback = getUserFeedback;
//# sourceMappingURL=feedback.controller.js.map