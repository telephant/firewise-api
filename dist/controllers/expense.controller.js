"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteExpense = exports.updateExpense = exports.createExpense = exports.getExpense = exports.getExpenses = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getExpenses = async (req, res) => {
    try {
        const userId = req.user.id;
        const { ledgerId } = req.params;
        const { page = '1', limit = '20', category_id, payment_method_id, start_date, end_date, } = req.query;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', ledgerId)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        let query = supabase_1.supabaseAdmin
            .from('expenses')
            .select('*', { count: 'exact' })
            .eq('ledger_id', ledgerId)
            .order('date', { ascending: false })
            .order('created_at', { ascending: false });
        if (category_id)
            query = query.eq('category_id', category_id);
        if (payment_method_id)
            query = query.eq('payment_method_id', payment_method_id);
        if (start_date)
            query = query.gte('date', start_date);
        if (end_date)
            query = query.lte('date', end_date);
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
        const offset = (pageNum - 1) * limitNum;
        query = query.range(offset, offset + limitNum - 1);
        const { data: expenses, error, count } = await query;
        if (error) {
            throw new error_1.AppError('Failed to fetch expenses', 500);
        }
        const categoryIds = [...new Set((expenses || []).map((e) => e.category_id).filter(Boolean))];
        const currencyIds = [...new Set((expenses || []).map((e) => e.currency_id).filter(Boolean))];
        const paymentMethodIds = [...new Set((expenses || []).map((e) => e.payment_method_id).filter(Boolean))];
        const creatorIds = [...new Set((expenses || []).map((e) => e.created_by).filter(Boolean))];
        const [categories, currencies, paymentMethods, profiles] = await Promise.all([
            categoryIds.length > 0
                ? supabase_1.supabaseAdmin.from('expense_categories').select('id, name').in('id', categoryIds)
                : { data: [] },
            currencyIds.length > 0
                ? supabase_1.supabaseAdmin.from('currencies').select('id, code, name').in('id', currencyIds)
                : { data: [] },
            paymentMethodIds.length > 0
                ? supabase_1.supabaseAdmin.from('payment_methods').select('id, name').in('id', paymentMethodIds)
                : { data: [] },
            creatorIds.length > 0
                ? supabase_1.supabaseAdmin.from('profiles').select('id, full_name, email').in('id', creatorIds)
                : { data: [] },
        ]);
        const categoryMap = new Map(categories.data?.map((c) => [c.id, c]) || []);
        const currencyMap = new Map(currencies.data?.map((c) => [c.id, c]) || []);
        const paymentMethodMap = new Map(paymentMethods.data?.map((p) => [p.id, p]) || []);
        const profileMap = new Map(profiles.data?.map((p) => [p.id, p]) || []);
        const expensesWithDetails = (expenses || []).map((expense) => ({
            ...expense,
            category: expense.category_id ? categoryMap.get(expense.category_id) || null : null,
            currency: expense.currency_id ? currencyMap.get(expense.currency_id) || null : null,
            payment_method: expense.payment_method_id ? paymentMethodMap.get(expense.payment_method_id) || null : null,
            created_by_profile: expense.created_by ? profileMap.get(expense.created_by) || null : null,
        }));
        res.json({
            success: true,
            data: {
                expenses: expensesWithDetails,
                total: count || 0,
            },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
    }
};
exports.getExpenses = getExpenses;
const getExpense = async (req, res) => {
    try {
        const userId = req.user.id;
        const { ledgerId, id } = req.params;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', ledgerId)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        const { data: expense, error } = await supabase_1.supabaseAdmin
            .from('expenses')
            .select('*')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (error || !expense) {
            res.status(404).json({ success: false, error: 'Expense not found' });
            return;
        }
        const [category, currency, paymentMethod, profile] = await Promise.all([
            expense.category_id
                ? supabase_1.supabaseAdmin.from('expense_categories').select('id, name').eq('id', expense.category_id).single()
                : { data: null },
            expense.currency_id
                ? supabase_1.supabaseAdmin.from('currencies').select('id, code, name').eq('id', expense.currency_id).single()
                : { data: null },
            expense.payment_method_id
                ? supabase_1.supabaseAdmin.from('payment_methods').select('id, name').eq('id', expense.payment_method_id).single()
                : { data: null },
            expense.created_by
                ? supabase_1.supabaseAdmin.from('profiles').select('id, full_name, email').eq('id', expense.created_by).single()
                : { data: null },
        ]);
        res.json({
            success: true,
            data: {
                ...expense,
                category: category.data || null,
                currency: currency.data || null,
                payment_method: paymentMethod.data || null,
                created_by_profile: profile.data || null,
            },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch expense' });
    }
};
exports.getExpense = getExpense;
const createExpense = async (req, res) => {
    try {
        const userId = req.user.id;
        const { ledgerId } = req.params;
        const { name, category_id, description, amount, currency_id, payment_method_id, date } = req.body;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', ledgerId)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Name is required' });
            return;
        }
        if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
            res.status(400).json({ success: false, error: 'Valid amount is required' });
            return;
        }
        if (!currency_id) {
            res.status(400).json({ success: false, error: 'Currency is required' });
            return;
        }
        const { data: expense, error } = await supabase_1.supabaseAdmin
            .from('expenses')
            .insert({
            name: name.trim(),
            ledger_id: ledgerId,
            category_id: category_id || null,
            description: description?.trim() || null,
            amount: parseFloat(amount),
            currency_id,
            payment_method_id: payment_method_id || null,
            date: date || new Date().toISOString().split('T')[0],
            created_by: userId,
        })
            .select()
            .single();
        if (error || !expense) {
            throw new error_1.AppError('Failed to create expense', 500);
        }
        res.status(201).json({ success: true, data: expense });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to create expense' });
    }
};
exports.createExpense = createExpense;
const updateExpense = async (req, res) => {
    try {
        const userId = req.user.id;
        const { ledgerId, id } = req.params;
        const { name, category_id, description, amount, currency_id, payment_method_id, date } = req.body;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', ledgerId)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        const { data: existingExpense, error: fetchError } = await supabase_1.supabaseAdmin
            .from('expenses')
            .select('id')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (fetchError || !existingExpense) {
            res.status(404).json({ success: false, error: 'Expense not found' });
            return;
        }
        const updates = { updated_at: new Date().toISOString() };
        if (name !== undefined)
            updates.name = name.trim();
        if (category_id !== undefined)
            updates.category_id = category_id || null;
        if (description !== undefined)
            updates.description = description?.trim() || null;
        if (amount !== undefined)
            updates.amount = parseFloat(amount);
        if (currency_id !== undefined)
            updates.currency_id = currency_id;
        if (payment_method_id !== undefined)
            updates.payment_method_id = payment_method_id || null;
        if (date !== undefined)
            updates.date = date;
        const { data: expense, error } = await supabase_1.supabaseAdmin
            .from('expenses')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error || !expense) {
            throw new error_1.AppError('Failed to update expense', 500);
        }
        res.json({ success: true, data: expense });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to update expense' });
    }
};
exports.updateExpense = updateExpense;
const deleteExpense = async (req, res) => {
    try {
        const userId = req.user.id;
        const { ledgerId, id } = req.params;
        const { data: ledgerUser, error: luError } = await supabase_1.supabaseAdmin
            .from('ledger_users')
            .select('role')
            .eq('ledger_id', ledgerId)
            .eq('user_id', userId)
            .single();
        if (luError || !ledgerUser) {
            res.status(404).json({ success: false, error: 'Ledger not found' });
            return;
        }
        const { data: existingExpense, error: fetchError } = await supabase_1.supabaseAdmin
            .from('expenses')
            .select('id')
            .eq('id', id)
            .eq('ledger_id', ledgerId)
            .single();
        if (fetchError || !existingExpense) {
            res.status(404).json({ success: false, error: 'Expense not found' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('expenses').delete().eq('id', id);
        if (error) {
            throw new error_1.AppError('Failed to delete expense', 500);
        }
        res.json({ success: true, message: 'Expense deleted successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to delete expense' });
    }
};
exports.deleteExpense = deleteExpense;
//# sourceMappingURL=expense.controller.js.map