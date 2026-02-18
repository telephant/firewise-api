import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import {
  AuthenticatedRequest,
  ApiResponse,
  Transaction,
  TransactionType,
  TransactionWithDetails,
  TransactionFilters,
  TransactionStats,
  Asset,
  ExpenseCategory,
  Debt,
} from '../types';
import { AppError } from '../middleware/error';
import { addConvertedFieldsToArray, addConvertedFieldsToSingle } from '../utils/currency-conversion';
import { getViewContext } from '../utils/family-context';

/**
 * Transaction Controller - Unified Transaction Log
 *
 * Transactions are the single source of truth for all financial movements.
 * Types: income, expense, buy, sell, debt_payment
 *
 * Write operations use domain-specific APIs:
 * - POST /fire/assets/transaction (invest, sell, transfer, add)
 * - POST /fire/debts/transaction (create, pay)
 * - POST /fire/income
 * - POST /fire/expense
 *
 * This controller provides read access to transaction history.
 */

/**
 * Get all transactions for the authenticated user
 */
export const getTransactions = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ transactions: TransactionWithDetails[]; total: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const {
      page = '1',
      limit = '20',
      type,
      start_date,
      end_date,
      asset_id,
      needs_review,
      exclude_category,
    } = req.query as unknown as TransactionFilters & { page: string; limit: string; needs_review?: string; exclude_category?: string };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 500);
    const offset = (pageNum - 1) * limitNum;

    // Build query from transactions table
    let query = supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // Apply ownership filter (belong_id)
    query = query.eq('belong_id', viewContext.belongId);

    if (type) query = query.eq('type', type);
    if (start_date) query = query.gte('date', start_date);
    if (end_date) query = query.lte('date', end_date);
    if (asset_id) {
      query = query.or(`asset_id.eq.${asset_id},source_asset_id.eq.${asset_id}`);
    }
    if (needs_review === 'true') query = query.eq('needs_review', true);
    if (exclude_category) query = query.neq('category', exclude_category);

    query = query.range(offset, offset + limitNum - 1);

    const { data: transactions, error, count } = await query;

    if (error) {
      throw new AppError('Failed to fetch transactions', 500);
    }

    // Get related assets, debts, and categories
    const assetIds = new Set<string>();
    const debtIds = new Set<string>();
    const categoryIds = new Set<string>();
    (transactions || []).forEach((tx) => {
      if (tx.asset_id) assetIds.add(tx.asset_id);
      if (tx.source_asset_id) assetIds.add(tx.source_asset_id);
      if (tx.debt_id) debtIds.add(tx.debt_id);
      if (tx.expense_category_id) categoryIds.add(tx.expense_category_id);
    });

    // Fetch related data in parallel
    const [assetsResult, debtsResult, categoriesResult] = await Promise.all([
      assetIds.size > 0
        ? supabaseAdmin.from('assets').select('*').in('id', Array.from(assetIds))
        : Promise.resolve({ data: [] }),
      debtIds.size > 0
        ? supabaseAdmin.from('debts').select('*').in('id', Array.from(debtIds))
        : Promise.resolve({ data: [] }),
      categoryIds.size > 0
        ? supabaseAdmin.from('flow_expense_categories').select('*').in('id', Array.from(categoryIds))
        : Promise.resolve({ data: [] }),
    ]);

    const assetMap = new Map<string, Asset>((assetsResult.data || []).map((a) => [a.id, a]));
    const debtMap = new Map<string, Debt>((debtsResult.data || []).map((d) => [d.id, d]));
    const categoryMap = new Map<string, ExpenseCategory>((categoriesResult.data || []).map((c) => [c.id, c]));

    // Map new field names to old ones for backward compatibility with frontend
    const transactionsWithDetails: TransactionWithDetails[] = (transactions || []).map((tx) => {
      const asset = tx.asset_id ? assetMap.get(tx.asset_id) || null : null;
      const sourceAsset = tx.source_asset_id ? assetMap.get(tx.source_asset_id) || null : null;
      const debt = tx.debt_id ? debtMap.get(tx.debt_id) || null : null;
      const expenseCategory = tx.expense_category_id ? categoryMap.get(tx.expense_category_id) || null : null;

      // Map to from_asset/to_asset based on transaction type for backward compatibility
      let fromAsset = null;
      let toAsset = null;
      switch (tx.type) {
        case 'income':
          toAsset = asset;  // Income goes TO an asset
          fromAsset = sourceAsset;  // Source (e.g., stock for dividend)
          break;
        case 'expense':
        case 'debt_payment':
          fromAsset = asset;  // Expense comes FROM an asset
          break;
        case 'buy':
          toAsset = asset;  // Buying adds TO investment
          fromAsset = sourceAsset;  // Paid FROM cash
          break;
        case 'sell':
          fromAsset = asset;  // Selling removes FROM investment
          toAsset = sourceAsset;  // Proceeds go TO cash
          break;
      }

      return {
        ...tx,
        // Related entities
        asset,
        source_asset: sourceAsset,
        debt,
        expense_category: expenseCategory,
        // Backward compatible field names (for existing frontend)
        from_asset: fromAsset,
        to_asset: toAsset,
        from_asset_id: fromAsset?.id || null,
        to_asset_id: toAsset?.id || null,
        user_id: tx.belong_id,
      };
    });

    // Add currency conversion fields if user has convert_all_to_preferred enabled
    const transactionsWithConversion = await addConvertedFieldsToArray(transactionsWithDetails, userId);

    res.json({
      success: true,
      data: {
        transactions: transactionsWithConversion,
        total: count || 0,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
  }
};

/**
 * Get a single transaction by ID
 */
export const getTransaction = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<TransactionWithDetails>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Build query from transactions table
    let query = supabaseAdmin.from('transactions').select('*').eq('id', id);

    // Apply ownership filter
    query = query.eq('belong_id', viewContext.belongId);

    const { data: transaction, error } = await query.single();

    if (error || !transaction) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    // Get related assets, debt, and expense category
    const [asset, sourceAsset, debt, expenseCategory] = await Promise.all([
      transaction.asset_id
        ? supabaseAdmin.from('assets').select('*').eq('id', transaction.asset_id).single()
        : { data: null },
      transaction.source_asset_id
        ? supabaseAdmin.from('assets').select('*').eq('id', transaction.source_asset_id).single()
        : { data: null },
      transaction.debt_id
        ? supabaseAdmin.from('debts').select('*').eq('id', transaction.debt_id).single()
        : { data: null },
      transaction.expense_category_id
        ? supabaseAdmin.from('flow_expense_categories').select('*').eq('id', transaction.expense_category_id).single()
        : { data: null },
    ]);

    // Map to from_asset/to_asset based on transaction type for backward compatibility
    const assetData = asset.data || null;
    const sourceAssetData = sourceAsset.data || null;
    let fromAsset = null;
    let toAsset = null;
    switch (transaction.type) {
      case 'income':
        toAsset = assetData;
        fromAsset = sourceAssetData;
        break;
      case 'expense':
      case 'debt_payment':
        fromAsset = assetData;
        break;
      case 'buy':
        toAsset = assetData;
        fromAsset = sourceAssetData;
        break;
      case 'sell':
        fromAsset = assetData;
        toAsset = sourceAssetData;
        break;
    }

    const transactionWithDetails: TransactionWithDetails = {
      ...transaction,
      // Related entities
      asset: assetData,
      source_asset: sourceAssetData,
      debt: debt.data || null,
      expense_category: expenseCategory.data || null,
      // Backward compatible field names
      from_asset: fromAsset,
      to_asset: toAsset,
      from_asset_id: fromAsset?.id || null,
      to_asset_id: toAsset?.id || null,
      user_id: transaction.belong_id,
    };

    // Add currency conversion fields if user has convert_all_to_preferred enabled
    const transactionWithConversion = await addConvertedFieldsToSingle(transactionWithDetails, userId);

    res.json({
      success: true,
      data: transactionWithConversion,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch transaction' });
  }
};

/**
 * Delete a transaction (for manual cleanup only)
 * Note: This only removes the transaction record, it does NOT reverse any balance changes.
 */
export const deleteTransaction = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if transaction exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('transactions').select('id').eq('id', id);

    checkQuery = checkQuery.eq('belong_id', viewContext.belongId);

    const { data: existingTx, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingTx) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    const { error } = await supabaseAdmin.from('transactions').delete().eq('id', id);

    if (error) {
      throw new AppError('Failed to delete transaction', 500);
    }

    res.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to delete transaction' });
  }
};

/**
 * Get transaction statistics for a date range
 */
export const getTransactionStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<TransactionStats>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
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

    // Get all transactions in the date range
    let query = supabaseAdmin
      .from('transactions')
      .select('type, amount, currency, category')
      .gte('date', startDate)
      .lte('date', endDate);

    // Apply ownership filter (belong_id)
    query = query.eq('belong_id', viewContext.belongId);

    const { data: transactions, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch transaction stats', 500);
    }

    // Calculate totals (simplified - assumes same currency for now)
    let totalIncome = 0;
    let totalExpense = 0;
    let totalInvestment = 0;

    (transactions || []).forEach((tx) => {
      const amount = Number(tx.amount);
      if (tx.type === 'income') {
        // Exclude transfers from income total
        if (tx.category !== 'transfer') totalIncome += amount;
      } else if (tx.type === 'expense') {
        // Exclude transfers from expense total
        if (tx.category !== 'transfer') totalExpense += amount;
      } else if (tx.type === 'buy') {
        totalInvestment += amount;
      } else if (tx.type === 'sell') {
        totalInvestment -= amount;
      }
    });

    res.json({
      success: true,
      data: {
        total_income: totalIncome,
        total_expense: totalExpense,
        total_investment: totalInvestment,
        net_flow: totalIncome - totalExpense,
        currency,
        start_date: startDate,
        end_date: endDate,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch transaction stats' });
  }
};

/**
 * Mark a transaction as reviewed (sets needs_review to false)
 */
export const markTransactionReviewed = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<Transaction>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const { id } = req.params;

    // Check if transaction exists and belongs to user/family
    let checkQuery = supabaseAdmin.from('transactions').select('id').eq('id', id);

    checkQuery = checkQuery.eq('belong_id', viewContext.belongId);

    const { data: existingTx, error: fetchError } = await checkQuery.single();

    if (fetchError || !existingTx) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    const { data: transaction, error } = await supabaseAdmin
      .from('transactions')
      .update({ needs_review: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new AppError('Failed to mark transaction as reviewed', 500);
    }

    res.json({ success: true, data: transaction });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to mark transaction as reviewed' });
  }
};

/**
 * Get count of transactions needing review
 */
export const getTransactionsNeedingReviewCount = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ count: number }>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    let query = supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('needs_review', true);

    // Apply ownership filter (belong_id)
    query = query.eq('belong_id', viewContext.belongId);

    const { count, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch review count', 500);
    }

    res.json({ success: true, data: { count: count || 0 } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.status(500).json({ success: false, error: 'Failed to fetch review count' });
  }
};
