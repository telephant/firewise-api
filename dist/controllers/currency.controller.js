"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCurrency = exports.getCurrencies = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getCurrencies = async (_req, res) => {
    try {
        const { data: currencies, error } = await supabase_1.supabaseAdmin
            .from('currencies')
            .select('*')
            .order('code', { ascending: true });
        if (error) {
            throw new error_1.AppError('Failed to fetch currencies', 500);
        }
        res.json({ success: true, data: currencies || [] });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch currencies' });
    }
};
exports.getCurrencies = getCurrencies;
const createCurrency = async (req, res) => {
    try {
        const { code, name, rate } = req.body;
        if (!code || typeof code !== 'string' || code.trim().length !== 3) {
            res.status(400).json({ success: false, error: 'Valid 3-letter currency code is required' });
            return;
        }
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Currency name is required' });
            return;
        }
        const rateNum = parseFloat(rate);
        if (isNaN(rateNum) || rateNum <= 0) {
            res.status(400).json({ success: false, error: 'Valid positive rate is required' });
            return;
        }
        const { data: existing } = await supabase_1.supabaseAdmin
            .from('currencies')
            .select('id')
            .eq('code', code.toUpperCase().trim())
            .single();
        if (existing) {
            res.status(400).json({ success: false, error: 'Currency code already exists' });
            return;
        }
        const { data: currency, error } = await supabase_1.supabaseAdmin
            .from('currencies')
            .insert({
            code: code.toUpperCase().trim(),
            name: name.trim(),
            rate: rateNum,
        })
            .select()
            .single();
        if (error || !currency) {
            throw new error_1.AppError('Failed to create currency', 500);
        }
        res.status(201).json({ success: true, data: currency });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to create currency' });
    }
};
exports.createCurrency = createCurrency;
//# sourceMappingURL=currency.controller.js.map