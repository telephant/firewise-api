"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCategory = exports.createCategory = exports.getCategories = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const getCategories = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: categories, error } = await supabase_1.supabaseAdmin
            .from('expense_categories')
            .select('*')
            .or(`created_by.eq.${userId},created_by.is.null`)
            .order('name', { ascending: true });
        if (error) {
            throw new error_1.AppError('Failed to fetch categories', 500);
        }
        res.json({ success: true, data: categories || [] });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }
};
exports.getCategories = getCategories;
const createCategory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            res.status(400).json({ success: false, error: 'Name is required' });
            return;
        }
        const { data: existing } = await supabase_1.supabaseAdmin
            .from('expense_categories')
            .select('id')
            .eq('name', name.trim())
            .eq('created_by', userId)
            .single();
        if (existing) {
            res.status(400).json({ success: false, error: 'Category already exists' });
            return;
        }
        const { data: category, error } = await supabase_1.supabaseAdmin
            .from('expense_categories')
            .insert({
            name: name.trim(),
            created_by: userId,
        })
            .select()
            .single();
        if (error || !category) {
            throw new error_1.AppError('Failed to create category', 500);
        }
        res.status(201).json({ success: true, data: category });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to create category' });
    }
};
exports.createCategory = createCategory;
const deleteCategory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { data: category, error: fetchError } = await supabase_1.supabaseAdmin
            .from('expense_categories')
            .select('created_by')
            .eq('id', id)
            .single();
        if (fetchError || !category) {
            res.status(404).json({ success: false, error: 'Category not found' });
            return;
        }
        if (category.created_by !== userId) {
            res.status(403).json({ success: false, error: 'Cannot delete this category' });
            return;
        }
        const { error } = await supabase_1.supabaseAdmin.from('expense_categories').delete().eq('id', id);
        if (error) {
            throw new error_1.AppError('Failed to delete category', 500);
        }
        res.json({ success: true, message: 'Category deleted successfully' });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        res.status(500).json({ success: false, error: 'Failed to delete category' });
    }
};
exports.deleteCategory = deleteCategory;
//# sourceMappingURL=category.controller.js.map