import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, FlowExpenseCategory } from '../types';
import { AppError } from '../middleware/error';

// Get all expense categories for the authenticated user
export const getFlowExpenseCategories = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowExpenseCategory[]>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { data: categories, error } = await supabaseAdmin
      .from('flow_expense_categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching flow expense categories:', error);
      throw new AppError('Failed to fetch expense categories', 500);
    }

    // If no categories exist, seed default ones
    if (!categories || categories.length === 0) {
      const { error: seedError } = await supabaseAdmin.rpc(
        'seed_default_flow_expense_categories',
        { p_user_id: userId }
      );

      if (seedError) {
        console.error('Error seeding default categories:', seedError);
        // Continue without seeding - user can create manually
      }

      // Fetch again after seeding
      const { data: seededCategories, error: refetchError } = await supabaseAdmin
        .from('flow_expense_categories')
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true });

      if (refetchError) {
        throw new AppError('Failed to fetch expense categories', 500);
      }

      res.json({ success: true, data: seededCategories || [] });
      return;
    }

    res.json({ success: true, data: categories });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in getFlowExpenseCategories:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch expense categories' });
  }
};

// Create a new expense category
export const createFlowExpenseCategory = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowExpenseCategory>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { name, icon, color } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    // Check if category already exists
    const { data: existing } = await supabaseAdmin
      .from('flow_expense_categories')
      .select('id')
      .eq('user_id', userId)
      .eq('name', name.trim())
      .single();

    if (existing) {
      res.status(400).json({ success: false, error: 'Category already exists' });
      return;
    }

    // Get max sort_order
    const { data: maxOrder } = await supabaseAdmin
      .from('flow_expense_categories')
      .select('sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxOrder?.sort_order || 0) + 1;

    const { data: category, error } = await supabaseAdmin
      .from('flow_expense_categories')
      .insert({
        user_id: userId,
        name: name.trim(),
        icon: icon || null,
        color: color || null,
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error || !category) {
      console.error('Error creating flow expense category:', error);
      throw new AppError('Failed to create expense category', 500);
    }

    res.status(201).json({ success: true, data: category });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in createFlowExpenseCategory:', err);
    res.status(500).json({ success: false, error: 'Failed to create expense category' });
  }
};

// Update an expense category
export const updateFlowExpenseCategory = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowExpenseCategory>>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, icon, color, sort_order } = req.body;

    // Check if category exists and belongs to user
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('flow_expense_categories')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      res.status(404).json({ success: false, error: 'Category not found' });
      return;
    }

    // If updating name, check for duplicates
    if (name && name.trim() !== existing.name) {
      const { data: duplicate } = await supabaseAdmin
        .from('flow_expense_categories')
        .select('id')
        .eq('user_id', userId)
        .eq('name', name.trim())
        .neq('id', id)
        .single();

      if (duplicate) {
        res.status(400).json({ success: false, error: 'Category name already exists' });
        return;
      }
    }

    const updates: Partial<FlowExpenseCategory> = {};
    if (name !== undefined) updates.name = name.trim();
    if (icon !== undefined) updates.icon = icon;
    if (color !== undefined) updates.color = color;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data: category, error } = await supabaseAdmin
      .from('flow_expense_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !category) {
      console.error('Error updating flow expense category:', error);
      throw new AppError('Failed to update expense category', 500);
    }

    res.json({ success: true, data: category });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in updateFlowExpenseCategory:', err);
    res.status(500).json({ success: false, error: 'Failed to update expense category' });
  }
};

// Delete an expense category
export const deleteFlowExpenseCategory = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Check if category exists and belongs to user
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('flow_expense_categories')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      res.status(404).json({ success: false, error: 'Category not found' });
      return;
    }

    // Set flow_expense_category_id to null for all flows using this category
    await supabaseAdmin
      .from('flows')
      .update({ flow_expense_category_id: null })
      .eq('flow_expense_category_id', id);

    const { error } = await supabaseAdmin
      .from('flow_expense_categories')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting flow expense category:', error);
      throw new AppError('Failed to delete expense category', 500);
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Error in deleteFlowExpenseCategory:', err);
    res.status(500).json({ success: false, error: 'Failed to delete expense category' });
  }
};
