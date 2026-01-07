import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import {
  AuthenticatedRequest,
  ApiResponse,
  Flow,
  FlowWithDetails,
  FlowFilters,
  FlowStatsResponse,
  Asset,
  FlowExpenseCategory,
} from '../types';
import { AppError } from '../middleware/error';

// Note: Asset balances are automatically updated by database trigger
// See migration 020_add_flow_balance_trigger.sql

/**
 * Get all flows for the authenticated user
 */
export const getFlows = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ flows: FlowWithDetails[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const {
      page = '1',
      limit = '20',
      type,
      start_date,
      end_date,
      asset_id,
    } = req.query as unknown as FlowFilters & { page: string; limit: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabaseAdmin
      .from('flows')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (start_date) query = query.gte('date', start_date);
    if (end_date) query = query.lte('date', end_date);
    if (asset_id) {
      query = query.or(`from_asset_id.eq.${asset_id},to_asset_id.eq.${asset_id}`);
    }

    query = query.range(offset, offset + limitNum - 1);

    const { data: flows, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch flows', 500);
    }

    // Get related assets
    const assetIds = new Set<string>();
    const categoryIds = new Set<string>();
    (flows || []).forEach((flow) => {
      if (flow.from_asset_id) assetIds.add(flow.from_asset_id);
      if (flow.to_asset_id) assetIds.add(flow.to_asset_id);
      if (flow.flow_expense_category_id) categoryIds.add(flow.flow_expense_category_id);
    });

    // Fetch assets and expense categories in parallel
    const [assetsResult, categoriesResult] = await Promise.all([
      assetIds.size > 0
        ? supabaseAdmin.from('assets').select('*').in('id', Array.from(assetIds))
        : Promise.resolve({ data: [] }),
      categoryIds.size > 0
        ? supabaseAdmin.from('flow_expense_categories').select('*').in('id', Array.from(categoryIds))
        : Promise.resolve({ data: [] }),
    ]);

    const assetMap = new Map<string, Asset>((assetsResult.data || []).map((a) => [a.id, a]));
    const categoryMap = new Map<string, FlowExpenseCategory>((categoriesResult.data || []).map((c) => [c.id, c]));

    const flowsWithDetails: FlowWithDetails[] = (flows || []).map((flow) => ({
      ...flow,
      from_asset: flow.from_asset_id ? assetMap.get(flow.from_asset_id) || null : null,
      to_asset: flow.to_asset_id ? assetMap.get(flow.to_asset_id) || null : null,
      flow_expense_category: flow.flow_expense_category_id ? categoryMap.get(flow.flow_expense_category_id) || null : null,
    }));

    res.json({
      success: true,
      data: {
        flows: flowsWithDetails,
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch flows' });
  }
};

/**
 * Get a single flow by ID
 */
export const getFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowWithDetails>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { data: flow, error } = await supabaseAdmin
      .from('flows')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !flow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    // Get related assets and expense category
    const [fromAsset, toAsset, expenseCategory] = await Promise.all([
      flow.from_asset_id
        ? supabaseAdmin.from('assets').select('*').eq('id', flow.from_asset_id).single()
        : { data: null },
      flow.to_asset_id
        ? supabaseAdmin.from('assets').select('*').eq('id', flow.to_asset_id).single()
        : { data: null },
      flow.flow_expense_category_id
        ? supabaseAdmin.from('flow_expense_categories').select('*').eq('id', flow.flow_expense_category_id).single()
        : { data: null },
    ]);

    res.json({
      success: true,
      data: {
        ...flow,
        from_asset: fromAsset.data || null,
        to_asset: toAsset.data || null,
        flow_expense_category: expenseCategory.data || null,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch flow' });
  }
};

/**
 * Create a new flow
 * Validates flow type constraints:
 * - income: from_asset_id must be null, to_asset_id must exist
 * - expense: from_asset_id must exist, to_asset_id must be null
 * - transfer: both from_asset_id and to_asset_id must exist
 */
export const createFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Flow>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const {
      type,
      amount,
      currency,
      from_asset_id,
      to_asset_id,
      category,
      date,
      description,
      tax_withheld,
      recurring_frequency,
      flow_expense_category_id,
      metadata,
    } = req.body;

    // Validate required fields
    if (!type || !['income', 'expense', 'transfer'].includes(type)) {
      res.status(400).json({ success: false, error: 'Valid flow type is required (income, expense, transfer)' });
      return;
    }

    if (amount === undefined || amount === null || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount is required' });
      return;
    }

    // Validate recurring_frequency if provided
    const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    if (recurring_frequency && !VALID_FREQUENCIES.includes(recurring_frequency)) {
      res.status(400).json({ success: false, error: 'Invalid recurring frequency' });
      return;
    }

    // Validate flow type constraints
    if (type === 'income') {
      if (from_asset_id) {
        res.status(400).json({ success: false, error: 'Income flows cannot have a from_asset_id' });
        return;
      }
      if (!to_asset_id) {
        res.status(400).json({ success: false, error: 'Income flows must have a to_asset_id' });
        return;
      }
    } else if (type === 'expense') {
      if (!from_asset_id) {
        res.status(400).json({ success: false, error: 'Expense flows must have a from_asset_id' });
        return;
      }
      if (to_asset_id) {
        res.status(400).json({ success: false, error: 'Expense flows cannot have a to_asset_id' });
        return;
      }
    } else if (type === 'transfer') {
      if (!from_asset_id || !to_asset_id) {
        res.status(400).json({ success: false, error: 'Transfer flows must have both from_asset_id and to_asset_id' });
        return;
      }
      if (from_asset_id === to_asset_id) {
        res.status(400).json({ success: false, error: 'Cannot transfer to the same asset' });
        return;
      }
    }

    // Verify assets and expense category belong to user (parallel checks)
    const [fromAssetResult, toAssetResult, expenseCategoryResult] = await Promise.all([
      from_asset_id
        ? supabaseAdmin.from('assets').select('id').eq('id', from_asset_id).eq('user_id', userId).single()
        : Promise.resolve({ data: { id: null } }),
      to_asset_id
        ? supabaseAdmin.from('assets').select('id').eq('id', to_asset_id).eq('user_id', userId).single()
        : Promise.resolve({ data: { id: null } }),
      flow_expense_category_id
        ? supabaseAdmin.from('flow_expense_categories').select('id').eq('id', flow_expense_category_id).eq('user_id', userId).single()
        : Promise.resolve({ data: { id: null } }),
    ]);

    if (from_asset_id && !fromAssetResult.data) {
      res.status(400).json({ success: false, error: 'From asset not found or does not belong to user' });
      return;
    }

    if (to_asset_id && !toAssetResult.data) {
      res.status(400).json({ success: false, error: 'To asset not found or does not belong to user' });
      return;
    }

    if (flow_expense_category_id && !expenseCategoryResult.data) {
      res.status(400).json({ success: false, error: 'Expense category not found or does not belong to user' });
      return;
    }

    const { data: flow, error } = await supabaseAdmin
      .from('flows')
      .insert({
        user_id: userId,
        type,
        amount: parseFloat(amount),
        currency: currency || 'USD',
        from_asset_id: from_asset_id || null,
        to_asset_id: to_asset_id || null,
        category: category?.trim() || null,
        date: date || new Date().toISOString().split('T')[0],
        description: description?.trim() || null,
        tax_withheld: tax_withheld ? parseFloat(tax_withheld) : null,
        recurring_frequency: recurring_frequency || null,
        flow_expense_category_id: flow_expense_category_id || null,
        metadata: metadata || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Flow create error:', error);
      throw new AppError('Failed to create flow', 500);
    }

    // Asset balances are automatically updated by database trigger
    res.status(201).json({ success: true, data: flow });
  } catch (err) {
    console.error('Flow create unexpected error:', err);
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to create flow' });
  }
};

/**
 * Update an existing flow
 */
export const updateFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Flow>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const {
      type,
      amount,
      currency,
      from_asset_id,
      to_asset_id,
      category,
      date,
      description,
      tax_withheld,
      recurring_frequency,
      flow_expense_category_id,
      metadata,
    } = req.body;

    // Check if flow exists and belongs to user
    const { data: existingFlow, error: fetchError } = await supabaseAdmin
      .from('flows')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingFlow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    // Build updates
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const newType = type !== undefined ? type : existingFlow.type;
    const newFromAssetId = from_asset_id !== undefined ? from_asset_id : existingFlow.from_asset_id;
    const newToAssetId = to_asset_id !== undefined ? to_asset_id : existingFlow.to_asset_id;

    // Validate flow type constraints if type or asset references are being updated
    if (type !== undefined || from_asset_id !== undefined || to_asset_id !== undefined) {
      if (newType === 'income') {
        if (newFromAssetId) {
          res.status(400).json({ success: false, error: 'Income flows cannot have a from_asset_id' });
          return;
        }
        if (!newToAssetId) {
          res.status(400).json({ success: false, error: 'Income flows must have a to_asset_id' });
          return;
        }
      } else if (newType === 'expense') {
        if (!newFromAssetId) {
          res.status(400).json({ success: false, error: 'Expense flows must have a from_asset_id' });
          return;
        }
        if (newToAssetId) {
          res.status(400).json({ success: false, error: 'Expense flows cannot have a to_asset_id' });
          return;
        }
      } else if (newType === 'transfer') {
        if (!newFromAssetId || !newToAssetId) {
          res.status(400).json({ success: false, error: 'Transfer flows must have both from_asset_id and to_asset_id' });
          return;
        }
        if (newFromAssetId === newToAssetId) {
          res.status(400).json({ success: false, error: 'Cannot transfer to the same asset' });
          return;
        }
      }
    }

    // Verify new assets and expense category belong to user (parallel checks)
    const checkFromAsset = from_asset_id !== undefined && from_asset_id !== null;
    const checkToAsset = to_asset_id !== undefined && to_asset_id !== null;
    const checkExpenseCategory = flow_expense_category_id !== undefined && flow_expense_category_id !== null;

    const [fromAssetResult, toAssetResult, expenseCategoryResult] = await Promise.all([
      checkFromAsset
        ? supabaseAdmin.from('assets').select('id').eq('id', from_asset_id).eq('user_id', userId).single()
        : Promise.resolve({ data: { id: null } }),
      checkToAsset
        ? supabaseAdmin.from('assets').select('id').eq('id', to_asset_id).eq('user_id', userId).single()
        : Promise.resolve({ data: { id: null } }),
      checkExpenseCategory
        ? supabaseAdmin.from('flow_expense_categories').select('id').eq('id', flow_expense_category_id).eq('user_id', userId).single()
        : Promise.resolve({ data: { id: null } }),
    ]);

    if (checkFromAsset && !fromAssetResult.data) {
      res.status(400).json({ success: false, error: 'From asset not found or does not belong to user' });
      return;
    }

    if (checkToAsset && !toAssetResult.data) {
      res.status(400).json({ success: false, error: 'To asset not found or does not belong to user' });
      return;
    }

    if (checkExpenseCategory && !expenseCategoryResult.data) {
      res.status(400).json({ success: false, error: 'Expense category not found or does not belong to user' });
      return;
    }

    if (type !== undefined) updates.type = type;
    if (amount !== undefined) updates.amount = parseFloat(amount);
    if (currency !== undefined) updates.currency = currency;
    if (from_asset_id !== undefined) updates.from_asset_id = from_asset_id || null;
    if (to_asset_id !== undefined) updates.to_asset_id = to_asset_id || null;
    if (category !== undefined) updates.category = category?.trim() || null;
    if (date !== undefined) updates.date = date;
    if (description !== undefined) updates.description = description?.trim() || null;
    if (tax_withheld !== undefined) updates.tax_withheld = tax_withheld ? parseFloat(tax_withheld) : null;
    if (recurring_frequency !== undefined) updates.recurring_frequency = recurring_frequency || null;
    if (flow_expense_category_id !== undefined) updates.flow_expense_category_id = flow_expense_category_id || null;
    if (metadata !== undefined) updates.metadata = metadata;

    const { data: flow, error } = await supabaseAdmin
      .from('flows')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Flow update error:', error);
      throw new AppError('Failed to update flow', 500);
    }

    // Asset balances are automatically updated by database trigger
    res.json({ success: true, data: flow });
  } catch (err) {
    console.error('Flow update unexpected error:', err);
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to update flow' });
  }
};

/**
 * Delete a flow
 */
export const deleteFlow = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Check if flow exists and belongs to user
    const { data: existingFlow, error: fetchError } = await supabaseAdmin
      .from('flows')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingFlow) {
      res.status(404).json({ success: false, error: 'Flow not found' });
      return;
    }

    const { error } = await supabaseAdmin.from('flows').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete flow', 500);
    }

    // Asset balances are automatically updated by database trigger
    res.json({ success: true, message: 'Flow deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete flow' });
  }
};

/**
 * Get flow statistics for a date range
 */
export const getFlowStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FlowStatsResponse>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { start_date, end_date, currency = 'USD' } = req.query as {
      start_date?: string;
      end_date?: string;
      currency?: string;
    };

    // Default to current month if no dates provided
    const now = new Date();
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const startDate = start_date || defaultStartDate;
    const endDate = end_date || defaultEndDate;

    // Get all flows in the date range
    const { data: flows, error } = await supabaseAdmin
      .from('flows')
      .select('type, amount, currency')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      throw new AppError('Failed to fetch flow stats', 500);
    }

    // Calculate totals (simplified - assumes same currency for now)
    let totalIncome = 0;
    let totalExpense = 0;
    let totalTransfer = 0;

    (flows || []).forEach((flow) => {
      const amount = Number(flow.amount);
      if (flow.type === 'income') totalIncome += amount;
      else if (flow.type === 'expense') totalExpense += amount;
      else if (flow.type === 'transfer') totalTransfer += amount;
    });

    res.json({
      success: true,
      data: {
        total_income: totalIncome,
        total_expense: totalExpense,
        total_transfer: totalTransfer,
        net_flow: totalIncome - totalExpense,
        currency,
        start_date: startDate,
        end_date: endDate,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch flow stats' });
  }
};
