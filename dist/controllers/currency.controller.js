"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCurrency = exports.createCurrency = exports.getCurrencies = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getCurrencies = async (req, res) => {
    try {
        const { ledgerId } = req.params;
        const { data: currencies, error } = await supabase_1.supabaseAdmin
            .from('currencies')
            .select('*')
            .eq('ledger_id', ledgerId)
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
        const { ledgerId } = req.params;
        const userId = req.user.id;
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
            .eq('ledger_id', ledgerId)
            .single();
        if (existing) {
            res.status(400).json({ success: false, error: 'Currency code already exists in this ledger' });
            return;
        }
        const { data: currency, error } = await supabase_1.supabaseAdmin
            .from('currencies')
            .insert({
            code: code.toUpperCase().trim(),
            name: name.trim(),
            rate: rateNum,
            ledger_id: ledgerId,
            created_by: userId,
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
const deleteCurrency = async (req, res) => {
    try {
        const { ledgerId, id } = req.params;
        const { data: currency, error: fetchError } = await supabase_1.supabaseAdmin
            .from('currencies')
            .select('ledger_id')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (fetchError || !currency) {
            res.status(404).json({ success: false, error: 'Currency not found' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('currencies').delete().eq('id', id);
        if (error) {
            throw new error_1.AppError('Failed to delete currency', 500);
        }
        res.json({ success: true, message: 'Currency deleted successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to delete currency' });
    }
};
exports.deleteCurrency = deleteCurrency;
//# sourceMappingURL=currency.controller.js.map