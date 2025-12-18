"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const supabase_1 = require("../config/supabase");
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            success: false,
            error: 'Missing or invalid authorization header',
        });
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        const { data, error } = await supabase_1.supabase.auth.getUser(token);
        if (error || !data.user) {
            res.status(401).json({
                success: false,
                error: 'Invalid or expired token',
            });
            return;
        }
        req.user = {
            id: data.user.id,
            email: data.user.email || '',
        };
        next();
    }
    catch {
        res.status(401).json({
            success: false,
            error: 'Authentication failed',
        });
    }
};
exports.authMiddleware = authMiddleware;
//# sourceMappingURL=auth.js.map