import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getViewContext } from '../utils/family-context';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Passive Income Controller
 *
 * Returns passive income stats including:
 * - interest
 * - dividend
 * - rental
 * - passive_other
 */

// Passive income categories
const PASSIVE_INCOME_CATEGORIES = ['interest', 'dividend', 'rental', 'passive_other'];

interface CategoryBreakdown {
  category: string;
  amount: number;
  count: number;
}

interface PassiveIncomeStats {
  thisMonth: {
    total: number;
    breakdown: CategoryBreakdown[];
  };
  annual: {
    total: number;
    breakdown: CategoryBreakdown[];
  };
  currency: string;
  year: number;
  month: number;
}

/**
 * GET /api/fire/passive-income
 *
 * Get passive income stats for current month and year
 */
export const getPassiveIncomeStats = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<PassiveIncomeStats>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    // Get user preferences for currency
    const preferences = await getUserPreferences(userId);
    const preferredCurrency = preferences?.preferred_currency || 'USD';
    const shouldConvert = preferences?.convert_all_to_preferred || false;

    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) || now.getMonth() + 1; // 1-12

    // Date ranges
    const monthStart = `${year}-${month.toString().padStart(2, '0')}-01`;
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

    // Last 12 months (rolling) instead of calendar year
    const twelveMonthsAgo = new Date(year, month - 1, 1); // First day of current month
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11); // Go back 11 months (12 months total including current)
    const annualStart = twelveMonthsAgo.toISOString().split('T')[0];
    const annualEnd = monthEnd; // Up to current month

    // Build query for passive income transactions
    // Interest can be either 'income' or 'transfer' type (deposit interest is recorded as transfer)
    let monthQuery = supabaseAdmin
      .from('transactions')
      .select('*')
      .in('category', PASSIVE_INCOME_CATEGORIES)
      .gte('date', monthStart)
      .lte('date', monthEnd);
    monthQuery = monthQuery.eq('belong_id', viewContext.belongId);

    let annualQuery = supabaseAdmin
      .from('transactions')
      .select('*')
      .in('category', PASSIVE_INCOME_CATEGORIES)
      .gte('date', annualStart)
      .lte('date', annualEnd);
    annualQuery = annualQuery.eq('belong_id', viewContext.belongId);

    const [monthResult, annualResult] = await Promise.all([
      monthQuery,
      annualQuery,
    ]);

    if (monthResult.error) {
      console.error('Failed to fetch month passive income:', monthResult.error);
      res.status(500).json({ success: false, error: 'Failed to fetch passive income stats' });
      return;
    }

    if (annualResult.error) {
      console.error('Failed to fetch annual passive income:', annualResult.error);
      res.status(500).json({ success: false, error: 'Failed to fetch passive income stats' });
      return;
    }

    // Get exchange rates if needed
    const currencies = new Set<string>([preferredCurrency.toLowerCase()]);
    [...(monthResult.data || []), ...(annualResult.data || [])].forEach((t) => {
      currencies.add((t.currency || 'USD').toLowerCase());
    });
    const rateMap = shouldConvert ? await getExchangeRates(Array.from(currencies)) : new Map<string, number>();

    // Helper to convert amount
    const convertToPreferred = (amount: number, fromCurrency: string): number => {
      if (!shouldConvert || fromCurrency.toLowerCase() === preferredCurrency.toLowerCase()) {
        return amount;
      }
      const result = convertAmount(amount, fromCurrency, preferredCurrency, rateMap);
      return result?.converted ?? amount;
    };

    // Calculate month breakdown
    const monthBreakdown = new Map<string, { amount: number; count: number }>();
    PASSIVE_INCOME_CATEGORIES.forEach((cat) => monthBreakdown.set(cat, { amount: 0, count: 0 }));

    (monthResult.data || []).forEach((t) => {
      const category = t.category || 'passive_other';
      const amount = convertToPreferred(t.amount, t.currency || 'USD');
      const existing = monthBreakdown.get(category) || { amount: 0, count: 0 };
      monthBreakdown.set(category, {
        amount: existing.amount + amount,
        count: existing.count + 1,
      });
    });

    // Calculate annual breakdown (last 12 months)
    const annualBreakdown = new Map<string, { amount: number; count: number }>();
    PASSIVE_INCOME_CATEGORIES.forEach((cat) => annualBreakdown.set(cat, { amount: 0, count: 0 }));

    (annualResult.data || []).forEach((t) => {
      const category = t.category || 'passive_other';
      const amount = convertToPreferred(t.amount, t.currency || 'USD');
      const existing = annualBreakdown.get(category) || { amount: 0, count: 0 };
      annualBreakdown.set(category, {
        amount: existing.amount + amount,
        count: existing.count + 1,
      });
    });

    // Format response
    const formatBreakdown = (breakdown: Map<string, { amount: number; count: number }>): CategoryBreakdown[] => {
      return Array.from(breakdown.entries())
        .map(([category, data]) => ({
          category,
          amount: data.amount,
          count: data.count,
        }))
        .filter((item) => item.amount > 0 || item.count > 0)
        .sort((a, b) => b.amount - a.amount);
    };

    const monthData = formatBreakdown(monthBreakdown);
    const annualData = formatBreakdown(annualBreakdown);

    res.json({
      success: true,
      data: {
        thisMonth: {
          total: monthData.reduce((sum, item) => sum + item.amount, 0),
          breakdown: monthData,
        },
        annual: {
          total: annualData.reduce((sum, item) => sum + item.amount, 0),
          breakdown: annualData,
        },
        currency: shouldConvert ? preferredCurrency : 'USD',
        year,
        month,
      },
    });
  } catch (err) {
    console.error('getPassiveIncomeStats error:', err);
    res.status(500).json({ success: false, error: 'Failed to get passive income stats' });
  }
};
