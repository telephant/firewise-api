import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, Transaction } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Income Controller
 *
 * Handles all income transactions:
 * - salary, bonus, freelance, gift, rental, refund, capital_gains
 * - dividend (from stock/ETF)
 * - interest (from deposit/savings)
 *
 * Each transaction:
 * 1. Validates input
 * 2. Increases to_asset balance (usually cash)
 * 3. Logs to flow table for audit
 */

// Suggested income categories (for documentation, not strict validation)
const SUGGESTED_INCOME_CATEGORIES = [
  'salary',
  'bonus',
  'dividend',
  'interest',
  'freelance',
  'gift',
  'rental',
  'capital_gains',
  'refund',
  'other',
  // Additional categories used by frontend
  'adjustment',
  'initial_balance',
  'deposit',
  'transfer',
  'loan_disbursement',
];

interface IncomeRequest {
  category: string;
  amount: number;
  to_asset_id?: string | null; // Optional for interest without linked account
  from_asset_id?: string; // Optional: stock for dividend, deposit for interest
  currency?: string;
  date?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface IncomeResult {
  transaction_id: string;
  to_asset: Asset | null;
  amount_added: number;
}

/**
 * POST /api/fire/income
 *
 * Record income transaction
 */
export const createIncome = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<IncomeResult>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    const {
      category,
      amount,
      to_asset_id,
      from_asset_id,
      currency = 'USD',
      date,
      description,
      metadata,
    } = req.body as IncomeRequest;

    // Validate category - accept any non-empty string
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Category is required'
      });
      return;
    }

    // Validate amount
    if (amount === undefined || amount === null || isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount is required' });
      return;
    }

    // Check if this is a no-account interest transaction
    const isNoAccountInterest = category === 'interest' &&
      metadata?.no_linked_account === true;

    // Validate to_asset_id (required unless it's a no-account interest)
    if (!to_asset_id && !isNoAccountInterest) {
      res.status(400).json({ success: false, error: 'to_asset_id is required' });
      return;
    }

    const flowDate = date || new Date().toISOString().split('T')[0];

    // Fetch to_asset (where income goes - usually cash)
    // Skip if no target asset (for no-account interest)
    let toAsset: Asset | null = null;
    if (to_asset_id) {
      const { data: ta, error: toAssetError } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', to_asset_id)
        .eq('belong_id', viewContext.belongId)
        .single();

      if (toAssetError || !ta) {
        res.status(400).json({ success: false, error: 'To asset not found' });
        return;
      }
      toAsset = ta;
    }

    // Optionally validate from_asset_id (e.g., stock for dividend)
    let fromAsset: Asset | null = null;
    if (from_asset_id) {
      const { data: fa, error: faError } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', from_asset_id)
        .eq('belong_id', viewContext.belongId)
        .single();
      if (faError || !fa) {
        res.status(400).json({ success: false, error: 'From asset not found' });
        return;
      }
      fromAsset = fa;
    }

    // Handle special cases
    let addAmount = amount;
    let updatedAsset: Asset | null = null;

    // Only process balance update if we have a target asset
    if (toAsset && to_asset_id) {
      const toAssetCurrency = toAsset.currency || 'USD';

      // Handle interest on deposit accounts (may add to from_asset instead of to_asset)
      // For interest, if from_asset is a deposit and to_asset is the same, add to deposit
      const isInterestOnDeposit = category === 'interest' && from_asset_id && from_asset_id === to_asset_id;

      // Convert currency if needed
      if (currency.toLowerCase() !== toAssetCurrency.toLowerCase()) {
        const rateMap = await getExchangeRates([currency.toLowerCase(), toAssetCurrency.toLowerCase()]);
        const conversion = convertAmount(amount, currency, toAssetCurrency, rateMap);
        if (conversion) {
          addAmount = conversion.converted;
        }
      }

      // Update to_asset balance
      const newBalance = Number(toAsset.balance) + addAmount;
      const { data: ua, error: updateError } = await supabaseAdmin
        .from('assets')
        .update({
          balance: newBalance,
          balance_updated_at: new Date().toISOString(),
        })
        .eq('id', to_asset_id)
        .select()
        .single();

      if (updateError) {
        throw new AppError('Failed to update asset balance', 500);
      }
      updatedAsset = ua;
    }

    // Build description
    let flowDescription = description;
    if (!flowDescription) {
      if (category === 'dividend' && fromAsset) {
        flowDescription = `Dividend from ${fromAsset.ticker || fromAsset.name}`;
      } else if (category === 'interest' && fromAsset) {
        flowDescription = `Interest from ${fromAsset.name}`;
      } else if (category === 'interest' && isNoAccountInterest) {
        flowDescription = 'Interest earned';
      } else {
        flowDescription = `${category.charAt(0).toUpperCase() + category.slice(1)} income`;
      }
    }

    // Log to transactions table
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        belong_id: viewContext.belongId,
        type: 'income',
        category: category,
        amount: amount,
        currency: currency,
        date: flowDate,
        asset_id: to_asset_id || null,  // Primary: where money goes (null for no-account interest)
        source_asset_id: from_asset_id || null,  // Source (stock for dividend)
        description: flowDescription,
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
        to_asset: updatedAsset,
        amount_added: updatedAsset ? addAmount : 0,
      },
    });
  } catch (err) {
    console.error('Income error:', err);
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to record income' });
  }
};

/**
 * GET /api/fire/income
 *
 * Get income history with optional filters
 */
export const getIncomeHistory = async (
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
      .eq('type', 'income')
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
      throw new AppError('Failed to fetch income history', 500);
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
    res.status(500).json({ success: false, error: 'Failed to fetch income history' });
  }
};

/**
 * GET /api/fire/income/stats
 *
 * Get income statistics for a date range
 */
export const getIncomeStats = async (
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

    // Get all income transactions in range
    let query = supabaseAdmin
      .from('transactions')
      .select('amount, currency, category')
      .eq('type', 'income')
      .gte('date', startDate)
      .lte('date', endDate);

    // Apply ownership filter (belong_id)
    query = query.eq('belong_id', viewContext.belongId);

    const { data: transactions, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch income stats', 500);
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
    res.status(500).json({ success: false, error: 'Failed to fetch income stats' });
  }
};
