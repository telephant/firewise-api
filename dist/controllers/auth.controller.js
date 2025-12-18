"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentUser = void 0;
const supabase_1 = require("../config/supabase");
const getCurrentUser = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: profile, error } = await supabase_1.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        if (error || !profile) {
            res.status(404).json({
                success: false,
                error: 'Profile not found',
            });
            return;
        }
        res.json({
            success: true,
            data: profile,
        });
    }
    catch {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user profile',
        });
    }
};
exports.getCurrentUser = getCurrentUser;
//# sourceMappingURL=auth.controller.js.map