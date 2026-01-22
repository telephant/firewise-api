import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import {
  AuthenticatedRequest,
  ApiResponse,
  ExpenseStatsResponse,
  CategoryStats,
  StatsFilters,
  MonthlyStatsResponse,
} from '../types';
import { AppError } from '../middleware/error';

export const getExpenseStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ExpenseStatsResponse>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { ledgerId } = req.params;
    const { start_date, end_date, currency_id } = req.query as StatsFilters;

    // 1. Authorization check - verify user has access to ledger
    const { data: ledgerUser, error: luError } = await supabaseAdmin
      .from('ledger_users')
      .select('role')
      .eq('ledger_id', ledgerId)
      .eq('user_id', userId)
      .single();

    if (luError || !ledgerUser) {
      res.status(404).json({ success: false, error: 'Ledger not found' });
      return;
    }

    // 2. Get all currencies for this ledger
    const { data: currencies, error: currError } = await supabaseAdmin
      .from('ledger_currencies')
      .select('id, code, name')
      .eq('ledger_id', ledgerId);

    if (currError || !currencies || currencies.length === 0) {
      // Return empty stats if no currencies
      res.json({
        success: true,
        data: {
          total: 0,
          currency_code: '',
          currency_id: '',
          by_category: [],
          start_date: start_date || '',
          end_date: end_date || '',
        },
      });
      return;
    }

    // 3. Determine target currency
    let targetCurrency = currencies.find((c) => c.id === currency_id);

    if (!targetCurrency) {
      // Default to ledger's default currency or first available
      const { data: ledger } = await supabaseAdmin
        .from('ledgers')
        .select('default_currency_id')
        .eq('id', ledgerId)
        .single();

      targetCurrency =
        currencies.find((c) => c.id === ledger?.default_currency_id) ||
        currencies.find((c) => c.code === 'USD') ||
        currencies[0];
    }

    // 4. Get exchange rates from currency_exchange table
    const currencyCodes = currencies.map((c) => c.code.toLowerCase());
    const { data: exchangeRates } = await supabaseAdmin
      .from('currency_exchange')
      .select('code, rate')
      .in('code', currencyCodes);

    // Build rate map: currency_id -> rate (from currency_exchange)
    const codeToRateMap: Record<string, number> = {};
    (exchangeRates || []).forEach((er) => {
      codeToRateMap[er.code] = er.rate;
    });

    const currencyRateMap: Record<string, number> = {};
    currencies.forEach((c) => {
      // Rate from currency_exchange (1 USD = X currency), default to 1 if not found
      currencyRateMap[c.id] = codeToRateMap[c.code.toLowerCase()] || 1;
    });

    // Get target currency rate
    const targetRate = codeToRateMap[targetCurrency.code.toLowerCase()] || 1;

    // 5. Query expenses with date filters
    let query = supabaseAdmin.from('expenses').select('category_id, amount, currency_id').eq('ledger_id', ledgerId);

    if (start_date) query = query.gte('date', start_date);
    if (end_date) query = query.lte('date', end_date);

    const { data: expenses, error: expError } = await query;

    if (expError) {
      throw new AppError('Failed to fetch expense data', 500);
    }

    // 6. Get category names
    const categoryIds = [...new Set((expenses || []).map((e) => e.category_id).filter(Boolean))] as string[];
    const { data: categories } = await supabaseAdmin
      .from('expense_categories')
      .select('id, name')
      .in('id', categoryIds.length > 0 ? categoryIds : ['']);

    const categoryMap = new Map((categories || []).map((c) => [c.id, c.name]));

    // 7. Perform aggregation with currency conversion
    const categoryTotals: Record<string, { amount: number; name: string }> = {};
    let grandTotal = 0;

    (expenses || []).forEach(
      (expense: {
        category_id: string | null;
        amount: number;
        currency_id: string;
      }) => {
        const sourceRate = currencyRateMap[expense.currency_id] || 1;

        // Convert: amount / sourceRate * targetRate
        const convertedAmount = (expense.amount / sourceRate) * targetRate;

        const categoryId = expense.category_id || 'uncategorized';
        const categoryName = expense.category_id ? categoryMap.get(expense.category_id) || 'Unknown' : 'Uncategorized';

        if (!categoryTotals[categoryId]) {
          categoryTotals[categoryId] = { amount: 0, name: categoryName };
        }
        categoryTotals[categoryId].amount += convertedAmount;
        grandTotal += convertedAmount;
      }
    );

    // 8. Build response with percentages, sorted by amount descending
    const byCategory: CategoryStats[] = Object.entries(categoryTotals)
      .map(([categoryId, data]) => ({
        category_id: categoryId === 'uncategorized' ? null : categoryId,
        category_name: data.name,
        amount: Math.round(data.amount * 100) / 100,
        percentage: grandTotal > 0 ? Math.round((data.amount / grandTotal) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // 9. Return aggregated stats
    res.json({
      success: true,
      data: {
        total: Math.round(grandTotal * 100) / 100,
        currency_code: targetCurrency.code,
        currency_id: targetCurrency.id,
        by_category: byCategory,
        start_date: start_date || '',
        end_date: end_date || '',
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch expense stats' });
  }
};

export const getMonthlyStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<MonthlyStatsResponse>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { ledgerId } = req.params;
    const { currency_id, months: monthsParam, category_id } = req.query as { currency_id?: string; months?: string; category_id?: string };

    const numMonths = Math.min(parseInt(monthsParam || '6', 10), 12);

    // 1. Authorization check
    const { data: ledgerUser, error: luError } = await supabaseAdmin
      .from('ledger_users')
      .select('role')
      .eq('ledger_id', ledgerId)
      .eq('user_id', userId)
      .single();

    if (luError || !ledgerUser) {
      res.status(404).json({ success: false, error: 'Ledger not found' });
      return;
    }

    // 2. Get all currencies for this ledger
    const { data: currencies, error: currError } = await supabaseAdmin
      .from('ledger_currencies')
      .select('id, code, name')
      .eq('ledger_id', ledgerId);

    if (currError || !currencies || currencies.length === 0) {
      res.json({
        success: true,
        data: {
          months: [],
          currency_code: '',
          currency_id: '',
        },
      });
      return;
    }

    // 3. Determine target currency
    let targetCurrency = currencies.find((c) => c.id === currency_id);

    if (!targetCurrency) {
      const { data: ledger } = await supabaseAdmin
        .from('ledgers')
        .select('default_currency_id')
        .eq('id', ledgerId)
        .single();

      targetCurrency =
        currencies.find((c) => c.id === ledger?.default_currency_id) ||
        currencies.find((c) => c.code === 'USD') ||
        currencies[0];
    }

    // 4. Get exchange rates from currency_exchange table
    const currencyCodes = currencies.map((c) => c.code.toLowerCase());
    const { data: exchangeRates } = await supabaseAdmin
      .from('currency_exchange')
      .select('code, rate')
      .in('code', currencyCodes);

    // Build rate map: currency_id -> rate (from currency_exchange)
    const codeToRateMap: Record<string, number> = {};
    (exchangeRates || []).forEach((er) => {
      codeToRateMap[er.code] = er.rate;
    });

    const currencyRateMap: Record<string, number> = {};
    currencies.forEach((c) => {
      currencyRateMap[c.id] = codeToRateMap[c.code.toLowerCase()] || 1;
    });

    // Get target currency rate
    const targetRate = codeToRateMap[targetCurrency.code.toLowerCase()] || 1;

    // 5. Calculate date range for last N months
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
    const startDate = new Date(now.getFullYear(), now.getMonth() - numMonths + 1, 1); // First day of (N months ago)

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // 6. Query all expenses in date range (include category_id for breakdown)
    const { data: expenses, error: expError } = await supabaseAdmin
      .from('expenses')
      .select('amount, currency_id, date, category_id')
      .eq('ledger_id', ledgerId)
      .gte('date', startDateStr)
      .lte('date', endDateStr);

    if (expError) {
      throw new AppError('Failed to fetch expense data', 500);
    }

    // 7. Get category names for all categories used
    const categoryIds = [...new Set((expenses || []).map((e) => e.category_id).filter(Boolean))] as string[];
    const { data: categories } = await supabaseAdmin
      .from('expense_categories')
      .select('id, name')
      .in('id', categoryIds.length > 0 ? categoryIds : ['']);

    const categoryMap = new Map((categories || []).map((c) => [c.id, c.name]));

    // 8. Group by month and category, convert currency
    const monthlyData: Record<string, { total: number; byCategory: Record<string, { amount: number; name: string }> }> = {};

    (expenses || []).forEach((expense: { amount: number; currency_id: string; date: string; category_id: string | null }) => {
      const expenseDate = new Date(expense.date);
      const monthKey = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;

      const sourceRate = currencyRateMap[expense.currency_id] || 1;
      const convertedAmount = (expense.amount / sourceRate) * targetRate;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { total: 0, byCategory: {} };
      }

      monthlyData[monthKey].total += convertedAmount;

      const categoryId = expense.category_id || 'uncategorized';
      const categoryName = expense.category_id ? categoryMap.get(expense.category_id) || 'Unknown' : 'Uncategorized';

      if (!monthlyData[monthKey].byCategory[categoryId]) {
        monthlyData[monthKey].byCategory[categoryId] = { amount: 0, name: categoryName };
      }
      monthlyData[monthKey].byCategory[categoryId].amount += convertedAmount;
    });

    // 9. Build response array for last N months (including months with 0 spending)
    const months: { month: string; total: number; by_category: { category_id: string | null; category_name: string; amount: number }[] }[] = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      const data = monthlyData[monthKey];

      const byCategory = data
        ? Object.entries(data.byCategory)
            .map(([catId, catData]) => ({
              category_id: catId === 'uncategorized' ? null : catId,
              category_name: catData.name,
              amount: Math.round(catData.amount * 100) / 100,
            }))
            .sort((a, b) => b.amount - a.amount)
        : [];

      months.push({
        month: monthKey,
        total: Math.round((data?.total || 0) * 100) / 100,
        by_category: byCategory,
      });
    }

    res.json({
      success: true,
      data: {
        months,
        currency_code: targetCurrency.code,
        currency_id: targetCurrency.id,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Monthly stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch monthly stats' });
  }
};
