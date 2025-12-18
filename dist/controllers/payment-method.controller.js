"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePaymentMethod = exports.createPaymentMethod = exports.getPaymentMethods = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getPaymentMethods = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: paymentMethods, error } = await supabase_1.supabaseAdmin
            .from('payment_methods')
            .select('*')
            .or(`created_by.eq.${userId},created_by.is.null`)
            .order('name', { ascending: true });
        if (error) {
            throw new error_1.AppError('Failed to fetch payment methods', 500);
        }
        res.json({ success: true, data: paymentMethods || [] });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch payment methods' });
    }
};
exports.getPaymentMethods = getPaymentMethods;
const createPaymentMethod = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, description } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Name is required' });
            return;
        }
        const { data: existing } = await supabase_1.supabaseAdmin
            .from('payment_methods')
            .select('id')
            .eq('name', name.trim())
            .eq('created_by', userId)
            .single();
        if (existing) {
            res.status(400).json({ success: false, error: 'Payment method already exists' });
            return;
        }
        const { data: paymentMethod, error } = await supabase_1.supabaseAdmin
            .from('payment_methods')
            .insert({
            name: name.trim(),
            description: description?.trim() || null,
            created_by: userId,
        })
            .select()
            .single();
        if (error || !paymentMethod) {
            throw new error_1.AppError('Failed to create payment method', 500);
        }
        res.status(201).json({ success: true, data: paymentMethod });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to create payment method' });
    }
};
exports.createPaymentMethod = createPaymentMethod;
const deletePaymentMethod = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { data: paymentMethod, error: fetchError } = await supabase_1.supabaseAdmin
            .from('payment_methods')
            .select('created_by')
            .eq('id', id)
            .single();
        if (fetchError || !paymentMethod) {
            res.status(404).json({ success: false, error: 'Payment method not found' });
            return;
        }
        if (paymentMethod.created_by !== userId) {
            res.status(403).json({ success: false, error: 'Cannot delete this payment method' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('payment_methods').delete().eq('id', id);
        if (error) {
            throw new error_1.AppError('Failed to delete payment method', 500);
        }
        res.json({ success: true, message: 'Payment method deleted successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to delete payment method' });
    }
};
exports.deletePaymentMethod = deletePaymentMethod;
//# sourceMappingURL=payment-method.controller.js.map