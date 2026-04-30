import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, Transaction } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Fire Expense Controller
 *
 * Handles all expense transactions for the FIRE tracking system:
 * - General expenses (groceries, utilities, dining, etc.)
 *
 * Each transaction:
 * 1. Validates input
 * 2. Decreases from_asset balance (usually cash)
 * 3. Logs to flow table for audit
 *
 * Note: Debt payments are handled by debt.controller.ts
 */

interface FireExpenseRequest {
  category: string;
  amount: number;
  from_asset_id: string;
  currency?: string;
  date?: string;
  description?: string;
  flow_expense_category_id?: string; // Optional reference to user-defined expense category
  metadata?: Record<string, unknown>;
}

interface FireExpenseResult {
  transaction_id: string;
  from_asset: Asset;
  amount_deducted: number;
}

/**
 * POST /api/fire/expense
 *
 * Record expense transaction
 */
export const createFireExpense = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<FireExpenseResult>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    const {
      category,
      amount,
      from_asset_id,
      currency = 'USD',
      date,
      description,
      flow_expense_category_id,
      metadata,
    } = req.body as FireExpenseRequest;

    // Validate category
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Category is required' });
      return;
    }

    // Validate amount
    if (amount === undefined || amount === null || isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount is required' });
      return;
    }

    // Validate from_asset_id
    if (!from_asset_id) {
      res.status(400).json({ success: false, error: 'from_asset_id is required' });
      return;
    }

    const flowDate = date || new Date().toISOString().split('T')[0];

    // Fetch from_asset (where expense comes from - usually cash)
    const { data: fromAsset, error: fromAssetError } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', from_asset_id)
      .eq('belong_id', viewContext.belongId)
      .single();

    if (fromAssetError || !fromAsset) {
      res.status(400).json({ success: false, error: 'From asset not found' });
      return;
    }

    // Optionally validate flow_expense_category_id
    if (flow_expense_category_id) {
      const { data: expenseCategory, error: catError } = await supabaseAdmin
        .from('flow_expense_categories')
        .select('id')
        .eq('id', flow_expense_category_id)
        .eq('belong_id', viewContext.belongId)
        .single();
      if (catError || !expenseCategory) {
        res.status(400).json({ success: false, error: 'Expense category not found' });
        return;
      }
    }

    // Calculate deduction amount (with currency conversion if needed)
    let deductAmount = amount;
    const fromAssetCurrency = fromAsset.currency || 'USD';

    if (currency.toLowerCase() !== fromAssetCurrency.toLowerCase()) {
      const rateMap = await getExchangeRates([currency.toLowerCase(), fromAssetCurrency.toLowerCase()]);
      const conversion = convertAmount(amount, currency, fromAssetCurrency, rateMap);
      if (conversion) {
        deductAmount = conversion.converted;
      }
    }

    // Update from_asset balance (prevent negative balance)
    const newBalance = Math.max(0, Number(fromAsset.balance) - deductAmount);
    const { data: updatedAsset, error: updateError } = await supabaseAdmin
      .from('assets')
      .update({
        balance: newBalance,
        balance_updated_at: new Date().toISOString(),
      })
      .eq('id', from_asset_id)
      .select()
      .single();

    if (updateError) {
      throw new AppError('Failed to update asset balance', 500);
    }

    // Log to transactions table
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        belong_id: viewContext.belongId,
        type: 'expense',
        category: category.trim(),
        amount: amount,
        currency: currency,
        date: flowDate,
        asset_id: from_asset_id,  // Primary: where money comes from
        expense_category_id: flow_expense_category_id || null,
        description: description?.trim() || null,
        metadata: metadata || null,
      })
      .select()
      .single();

    if (txError) {
      throw new AppError('Failed to log transaction', 500);
    }

    res.status(201).json({
      success: true,
      data: {
        transaction_id: transaction.id,
        from_asset: updatedAsset,
        amount_deducted: deductAmount,
      },
    });
  } catch (err) {
    console.error('Fire expense error:', err);
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to record expense' });
  }
};

/**
 * GET /api/fire/expense
 *
 * Get expense history with optional filters
 */
export const getFireExpenseHistory = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ transactions: Transaction[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const {
      page = '1',
      limit = '50',
      category,
      start_date,
      end_date,
    } = req.query as {
      page?: string;
      limit?: string;
      category?: string;
      start_date?: string;
      end_date?: string;
    };

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build query - use transactions table
    let query = supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('type', 'expense')
      .neq('category', 'transfer') // Exclude transfers (they show elsewhere)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // Apply ownership filter (belong_id)
    query = query.eq('belong_id', viewContext.belongId);

    // Apply filters
    if (category) query = query.eq('category', category);
    if (start_date) query = query.gte('date', start_date);
    if (end_date) query = query.lte('date', end_date);

    query = query.range(offset, offset + limitNum - 1);

    const { data: transactions, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch expense history', 500);
    }

    res.json({
      success: true,
      data: {
        transactions: transactions || [],
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch expense history' });
  }
};

/**
 * GET /api/fire/expense/stats
 *
 * Get expense statistics for a date range
 */
export const getFireExpenseStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{
    total: number;
    by_category: Record<string, number>;
    currency: string;
    start_date: string;
    end_date: string;
  }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { start_date, end_date, currency = 'USD' } = req.query as {
      start_date?: string;
      end_date?: string;
      currency?: string;
    };

    // Default to current month
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const startDate = start_date || defaultStart;
    const endDate = end_date || defaultEnd;

    // Get all expense transactions in range (excluding transfers)
    let query = supabaseAdmin
      .from('transactions')
      .select('amount, currency, category')
      .eq('type', 'expense')
      .neq('category', 'transfer')
      .gte('date', startDate)
      .lte('date', endDate);

    // Apply ownership filter (belong_id)
    query = query.eq('belong_id', viewContext.belongId);

    const { data: transactions, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch expense stats', 500);
    }

    // Calculate totals (simplified - assumes same currency)
    let total = 0;
    const byCategory: Record<string, number> = {};

    (transactions || []).forEach((tx) => {
      const amount = Number(tx.amount);
      total += amount;

      const cat = tx.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + amount;
    });

    res.json({
      success: true,
      data: {
        total,
        by_category: byCategory,
        currency,
        start_date: startDate,
        end_date: endDate,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch expense stats' });
  }
};
