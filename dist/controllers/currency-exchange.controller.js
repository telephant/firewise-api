"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrency = exports.searchCurrencies = void 0;
const supabase_1 = require("../config/supabase");
/**
 * Search currencies from the global currency_exchange table
 * GET /currency-exchange/search?q=usd&limit=20
 */
const searchCurrencies = async (req, res) => {
    try {
        const { q, limit = '20' } = req.query;
        const limitNum = Math.min(parseInt(limit, 10) || 20, 50);
        let query = supabase_1.supabaseAdmin
            .from('currency_exchange')
            .select('code, name, rate')
            .order('code', { ascending: true })
            .limit(limitNum);
        if (q && typeof q === 'string' && q.trim()) {
            const search = q.trim().toLowerCase();
            // Search by code or name (case-insensitive)
            query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error searching currencies:', error);
            res.status(500).json({ success: false, error: 'Failed to search currencies' });
            return;
        }
        res.json({ success: true, data: data || [] });
    }
    catch (err) {
        console.error('Error in searchCurrencies:', err);
        res.status(500).json({ success: false, error: 'Failed to search currencies' });
    }
};
exports.searchCurrencies = searchCurrencies;
/**
 * Get a single currency by code
 * GET /currency-exchange/:code
 */
const getCurrency = async (req, res) => {
    try {
        const { code } = req.params;
        const { data, error } = await supabase_1.supabaseAdmin
            .from('currency_exchange')
            .select('code, name, rate')
            .eq('code', code.toLowerCase())
            .single();
        if (error || !data) {
            res.status(404).json({ success: false, error: 'Currency not found' });
            return;
        }
        res.json({ success: true, data });
    }
    catch (err) {
        console.error('Error in getCurrency:', err);
        res.status(500).json({ success: false, error: 'Failed to get currency' });
    }
};
exports.getCurrency = getCurrency;
//# sourceMappingURL=currency-exchange.controller.js.map