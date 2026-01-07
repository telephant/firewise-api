"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCurrency = exports.getCurrencyUsage = exports.updateCurrency = exports.createCurrency = exports.getCurrencies = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getCurrencies = async (req, res) => {
    try {
        const { ledgerId } = req.params;
        const { data: currencies, error } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
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
        const { code, name } = req.body;
        if (!code || typeof code !== 'string' || code.trim().length !== 3) {
            res.status(400).json({ success: false, error: 'Valid 3-letter currency code is required' });
            return;
        }
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Currency name is required' });
            return;
        }
        const { data: existing } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
            .select('id')
            .eq('code', code.toUpperCase().trim())
            .eq('ledger_id', ledgerId)
            .single();
        if (existing) {
            res.status(400).json({ success: false, error: 'Currency code already exists in this ledger' });
            return;
        }
        const { data: currency, error } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
            .insert({
            code: code.toUpperCase().trim(),
            name: name.trim(),
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
const updateCurrency = async (req, res) => {
    try {
        const { ledgerId, id } = req.params;
        const { code, name } = req.body;
        // Check if currency exists
        const { data: existing, error: fetchError } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
            .select('*')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (fetchError || !existing) {
            res.status(404).json({ success: false, error: 'Currency not found' });
            return;
        }
        // Validate inputs if provided
        if (code !== undefined) {
            if (typeof code !== 'string' || code.trim().length !== 3) {
                res.status(400).json({ success: false, error: 'Valid 3-letter currency code is required' });
                return;
            }
            // Check if another currency with the same code exists
            const { data: duplicate } = await supabase_1.supabaseAdmin
                .from('ledger_currencies')
                .select('id')
                .eq('code', code.toUpperCase().trim())
                .eq('ledger_id', ledgerId)
                .neq('id', id)
                .single();
            if (duplicate) {
                res.status(400).json({ success: false, error: 'Currency code already exists' });
                return;
            }
        }
        if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
            res.status(400).json({ success: false, error: 'Currency name is required' });
            return;
        }
        const updateData = {};
        if (code !== undefined)
            updateData.code = code.toUpperCase().trim();
        if (name !== undefined)
            updateData.name = name.trim();
        const { data: currency, error } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        if (error || !currency) {
            throw new error_1.AppError('Failed to update currency', 500);
        }
        res.json({ success: true, data: currency });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to update currency' });
    }
};
exports.updateCurrency = updateCurrency;
const getCurrencyUsage = async (req, res) => {
    try {
        const { ledgerId, id } = req.params;
        // Verify currency exists and belongs to ledger
        const { data: currency, error: fetchError } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
            .select('id')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (fetchError || !currency) {
            res.status(404).json({ success: false, error: 'Currency not found' });
            return;
        }
        // Count expenses using this currency
        const { count, error } = await supabase_1.supabaseAdmin
            .from('expenses')
            .select('*', { count: 'exact', head: true })
            .eq('currency_id', id);
        if (error) {
            throw new error_1.AppError('Failed to get currency usage', 500);
        }
        res.json({ success: true, data: { count: count || 0 } });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to get currency usage' });
    }
};
exports.getCurrencyUsage = getCurrencyUsage;
const deleteCurrency = async (req, res) => {
    try {
        const { ledgerId, id } = req.params;
        const { data: currency, error: fetchError } = await supabase_1.supabaseAdmin
            .from('ledger_currencies')
            .select('ledger_id')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (fetchError || !currency) {
            res.status(404).json({ success: false, error: 'Currency not found' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('ledger_currencies').delete().eq('id', id);
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