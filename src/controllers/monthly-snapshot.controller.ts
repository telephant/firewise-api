import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Monthly Financial Snapshot Controller
 *
 * Retrieves historical monthly snapshots for comparison and tracking.
 */

interface MonthlySnapshot {
  id: string;
  belong_id: string;
  year: number;
  month: number;
  snapshot_date: string;
  currency: string;
  total_assets: number;
  total_debts: number;
  net_worth: number;
  total_income: number;
  active_income: number;
  passive_income: number;
  avg_passive_income_12m: number;
  total_expenses: number;
  assets: unknown[];
  debts: unknown[];
  assets_by_type: Record<string, number>;
  income_by_category: Record<string, number>;
  expenses_by_category: Record<string, number>;
  created_at: string;
  // Converted amounts in user's preferred currency
  converted_currency?: string;
  converted_total_assets?: number;
  converted_total_debts?: number;
  converted_net_worth?: number;
  converted_total_income?: number;
  converted_passive_income?: number;
  converted_avg_passive_income_12m?: number;
  converted_total_expenses?: number;
}

/**
 * GET /api/fire/snapshots
 *
 * Get monthly snapshots with optional filters
 * Query params:
 *   - year: Filter by year
 *   - start_month: Start month (YYYY-MM format)
 *   - end_month: End month (YYYY-MM format)
 *   - limit: Max results (default 12)
 */
export const getSnapshots = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ snapshots: MonthlySnapshot[] }>>
): Promise<void> => {
  try {
    const viewContext = await getViewContext(req);
    const {
      year,
      start_month,
      end_month,
      limit = '12',
    } = req.query as {
      year?: string;
      start_month?: string;
      end_month?: string;
      limit?: string;
    };

    let query = supabaseAdmin
      .from('monthly_financial_snapshots')
      .select('*')
      .eq('belong_id', viewContext.belongId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(parseInt(limit, 10) || 12);

    // Filter by year
    if (year) {
      query = query.eq('year', parseInt(year, 10));
    }

    // Filter by date range (YYYY-MM format)
    if (start_month) {
      const [startYear, startMo] = start_month.split('-').map(Number);
      query = query.or(`year.gt.${startYear},and(year.eq.${startYear},month.gte.${startMo})`);
    }

    if (end_month) {
      const [endYear, endMo] = end_month.split('-').map(Number);
      query = query.or(`year.lt.${endYear},and(year.eq.${endYear},month.lte.${endMo})`);
    }

    const { data: snapshots, error } = await query;

    if (error) {
      throw new AppError('Failed to fetch snapshots', 500);
    }

    // Get user's preferred currency and convert amounts
    const prefs = await getUserPreferences(req.user!.id);
    const preferredCurrency = prefs?.preferred_currency || 'USD';

    let convertedSnapshots = snapshots || [];

    // Convert amounts to user's preferred currency if not USD
    if (preferredCurrency.toUpperCase() !== 'USD' && convertedSnapshots.length > 0) {
      const rateMap = await getExchangeRates([preferredCurrency]);

      convertedSnapshots = convertedSnapshots.map((snapshot) => {
        const convert = (amount: number) => {
          const result = convertAmount(amount, 'USD', preferredCurrency, rateMap);
          return result ? Math.round(result.converted * 100) / 100 : amount;
        };

        return {
          ...snapshot,
          converted_currency: preferredCurrency,
          converted_total_assets: convert(snapshot.total_assets),
          converted_total_debts: convert(snapshot.total_debts),
          converted_net_worth: convert(snapshot.net_worth),
          converted_total_income: convert(snapshot.total_income),
          converted_passive_income: convert(snapshot.passive_income),
          converted_avg_passive_income_12m: convert(snapshot.avg_passive_income_12m || 0),
          converted_total_expenses: convert(snapshot.total_expenses),
        };
      });
    }

    res.json({
      success: true,
      data: { snapshots: convertedSnapshots },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch snapshots' });
  }
};

/**
 * GET /api/fire/snapshots/:year/:month
 *
 * Get a specific month's snapshot
 */
export const getSnapshot = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<MonthlySnapshot | null>>
): Promise<void> => {
  try {
    const viewContext = await getViewContext(req);
    const { year, month } = req.params;

    const { data: snapshot, error } = await supabaseAdmin
      .from('monthly_financial_snapshots')
      .select('*')
      .eq('belong_id', viewContext.belongId)
      .eq('year', parseInt(year, 10))
      .eq('month', parseInt(month, 10))
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new AppError('Failed to fetch snapshot', 500);
    }

    res.json({
      success: true,
      data: snapshot || null,
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch snapshot' });
  }
};

/**
 * GET /api/fire/snapshots/compare
 *
 * Compare two months' snapshots
 * Query params:
 *   - from: YYYY-MM format (required)
 *   - to: YYYY-MM format (required)
 */
export const compareSnapshots = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{
    from: MonthlySnapshot | null;
    to: MonthlySnapshot | null;
    changes: {
      net_worth: number;
      net_worth_pct: number;
      total_assets: number;
      total_debts: number;
      total_income: number;
      passive_income: number;
      total_expenses: number;
    } | null;
  }>>
): Promise<void> => {
  try {
    const viewContext = await getViewContext(req);
    const { from, to } = req.query as { from?: string; to?: string };

    if (!from || !to) {
      res.status(400).json({ success: false, error: 'Both "from" and "to" params required (YYYY-MM)' });
      return;
    }

    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);

    // Fetch both snapshots in parallel
    const [fromResult, toResult] = await Promise.all([
      supabaseAdmin
        .from('monthly_financial_snapshots')
        .select('*')
        .eq('belong_id', viewContext.belongId)
        .eq('year', fromYear)
        .eq('month', fromMonth)
        .single(),
      supabaseAdmin
        .from('monthly_financial_snapshots')
        .select('*')
        .eq('belong_id', viewContext.belongId)
        .eq('year', toYear)
        .eq('month', toMonth)
        .single(),
    ]);

    const fromSnapshot = fromResult.data;
    const toSnapshot = toResult.data;

    let changes = null;
    if (fromSnapshot && toSnapshot) {
      const netWorthChange = toSnapshot.net_worth - fromSnapshot.net_worth;
      changes = {
        net_worth: netWorthChange,
        net_worth_pct: fromSnapshot.net_worth !== 0
          ? Math.round((netWorthChange / Math.abs(fromSnapshot.net_worth)) * 10000) / 100
          : 0,
        total_assets: toSnapshot.total_assets - fromSnapshot.total_assets,
        total_debts: toSnapshot.total_debts - fromSnapshot.total_debts,
        total_income: toSnapshot.total_income - fromSnapshot.total_income,
        passive_income: toSnapshot.passive_income - fromSnapshot.passive_income,
        total_expenses: toSnapshot.total_expenses - fromSnapshot.total_expenses,
      };
    }

    res.json({
      success: true,
      data: {
        from: fromSnapshot || null,
        to: toSnapshot || null,
        changes,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to compare snapshots' });
  }
};

/**
 * GET /api/fire/snapshots/trend
 *
 * Get net worth trend over time
 * Query params:
 *   - months: Number of months to include (default 12)
 */
export const getNetWorthTrend = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{
    trend: Array<{
      year: number;
      month: number;
      net_worth: number;
      total_assets: number;
      total_debts: number;
      passive_income: number;
    }>;
  }>>
): Promise<void> => {
  try {
    const viewContext = await getViewContext(req);
    const { months = '12' } = req.query as { months?: string };

    const { data: snapshots, error } = await supabaseAdmin
      .from('monthly_financial_snapshots')
      .select('year, month, net_worth, total_assets, total_debts, passive_income')
      .eq('belong_id', viewContext.belongId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(parseInt(months, 10) || 12);

    if (error) {
      throw new AppError('Failed to fetch trend data', 500);
    }

    // Reverse to show oldest first
    const trend = (snapshots || []).reverse();

    res.json({
      success: true,
      data: { trend },
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch trend data' });
  }
};
