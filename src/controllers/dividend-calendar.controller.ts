import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getViewContext } from '../utils/family-context';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';
import * as findata from '../utils/findata-client';

/**
 * Dividend Calendar Controller
 *
 * Returns dividend calendar data with:
 * - Actual dividends from DB
 * - Forecasted dividends from findata service (via yfinance)
 */

type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

interface MonthDividend {
  ticker: string;
  assetId: string;
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  isForecasted: boolean;
  date?: string;
  frequency?: ScheduleFrequency | null;
  market?: string | null; // 'US', 'SG', etc.
}

interface MonthData {
  month: number;
  name: string;
  dividends: MonthDividend[];
  total: number;
}

interface TaxRates {
  us: number; // US dividend withholding rate
  sg: number; // SG dividend withholding rate
}

interface DividendCalendarResponse {
  year: number;
  months: MonthData[];
  annualTotal: number;
  currency: string;
  taxRate: number; // @deprecated - use taxRates instead
  taxRates: TaxRates; // Tax rates by market
  // Debug info
  debug?: {
    stockCount: number;
    dividendCount: number;
    historicalCount: number;
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Map findata frequency to ScheduleFrequency
 */
function mapFrequency(freq: string | null): ScheduleFrequency | null {
  if (!freq) return null;
  const freqMap: Record<string, ScheduleFrequency> = {
    monthly: 'monthly',
    quarterly: 'quarterly',
    yearly: 'yearly',
  };
  return freqMap[freq.toLowerCase()] || null;
}

/**
 * GET /api/fire/dividend-calendar
 *
 * Get dividend calendar data for a specific year
 */
export const getDividendCalendar = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DividendCalendarResponse>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    // Get user preferences for currency
    const preferences = await getUserPreferences(userId);
    const preferredCurrency = preferences?.preferred_currency || 'USD';
    const shouldConvert = preferences?.convert_all_to_preferred || false;

    // Always get user's tax settings for frontend calculation
    const { data: taxSettings } = await supabaseAdmin
      .from('user_tax_settings')
      .select('us_dividend_withholding_rate, sg_dividend_withholding_rate')
      .eq('user_id', userId)
      .single();

    const taxRates: TaxRates = {
      us: taxSettings?.us_dividend_withholding_rate ?? 0.30, // Default 30%
      sg: taxSettings?.sg_dividend_withholding_rate ?? 0.00, // Default 0%
    };
    const taxRate = taxRates.us; // Keep for backwards compatibility

    // Initialize months data
    const months: MonthData[] = MONTH_NAMES.map((name, index) => ({
      month: index,
      name,
      dividends: [],
      total: 0,
    }));

    // 1. Get user's stock and ETF holdings
    let assetsQuery = supabaseAdmin
      .from('assets')
      .select('*')
      .in('type', ['stock', 'etf'])
      .not('ticker', 'is', null);
    assetsQuery = assetsQuery.eq('belong_id', viewContext.belongId);

    const { data: stockAssets, error: assetsError } = await assetsQuery;

    if (assetsError) {
      console.error('Failed to fetch assets:', assetsError);
      res.status(500).json({ success: false, error: 'Failed to fetch assets' });
      return;
    }

    if (!stockAssets || stockAssets.length === 0) {
      res.json({
        success: true,
        data: { year, months, annualTotal: 0, currency: preferredCurrency, taxRate, taxRates },
      });
      return;
    }

    // 2. Get actual dividends for the year from DB
    let dividendsQuery = supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('type', 'income')
      .eq('category', 'dividend')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`);
    dividendsQuery = dividendsQuery.eq('belong_id', viewContext.belongId);

    const { data: actualDividends, error: dividendsError } = await dividendsQuery;

    if (dividendsError) {
      console.error('Failed to fetch dividends:', dividendsError);
    }

    // 3. Collect currencies and get exchange rates
    const assetMap = new Map(stockAssets.map((a) => [a.id, a]));
    const currencies = new Set<string>([preferredCurrency.toLowerCase()]);

    // Collect currencies from actual dividends
    actualDividends?.forEach((t) => {
      currencies.add((t.currency || 'USD').toLowerCase());
    });

    // Collect currencies from stock assets (for forecasts)
    stockAssets.forEach((a) => {
      currencies.add((a.currency || 'USD').toLowerCase());
    });

    const rateMap = shouldConvert ? await getExchangeRates(Array.from(currencies)) : new Map<string, number>();

    // Helper to convert amount
    const convertToPreferred = (amount: number, fromCurrency: string): { amount: number; original: number; originalCurrency: string } => {
      if (!shouldConvert || fromCurrency.toLowerCase() === preferredCurrency.toLowerCase()) {
        return { amount, original: amount, originalCurrency: fromCurrency };
      }
      const result = convertAmount(amount, fromCurrency, preferredCurrency, rateMap);
      return {
        amount: result?.converted ?? amount,
        original: amount,
        originalCurrency: fromCurrency,
      };
    };

    // 5. Add actual dividends from DB to months (return GROSS amount, frontend applies tax)
    actualDividends?.forEach((t) => {
      const month = new Date(t.date).getMonth();
      const asset = assetMap.get(t.source_asset_id) || assetMap.get(t.asset_id);
      const ticker = (t.metadata?.ticker as string) || asset?.ticker || 'Unknown';
      const dividendCurrency = t.currency || 'USD';

      // Calculate GROSS amount from metadata (t.amount is NET after tax)
      // GROSS = NET + tax_withheld, or = dividend_per_share * share_count
      let grossAmount = t.amount;
      const taxWithheld = t.metadata?.tax_withheld as number | undefined;
      const dividendPerShare = t.metadata?.dividend_per_share as number | undefined;
      const shareCount = t.metadata?.share_count as number | undefined;

      if (dividendPerShare && shareCount) {
        // Preferred: calculate from per-share amount
        grossAmount = dividendPerShare * shareCount;
      } else if (taxWithheld && taxWithheld > 0) {
        // Fallback: add back the tax
        grossAmount = t.amount + taxWithheld;
      }

      const converted = convertToPreferred(grossAmount, dividendCurrency);

      months[month].dividends.push({
        ticker,
        assetId: t.source_asset_id || t.asset_id || '',
        amount: converted.amount,
        originalAmount: shouldConvert ? converted.original : undefined,
        originalCurrency: shouldConvert ? converted.originalCurrency : undefined,
        isForecasted: false,
        date: t.date,
        market: asset?.market || null,
      });
      months[month].total += converted.amount;
    });

    // Track which months already have DB dividends per ticker
    const receivedMonthsByTicker = new Map<string, Set<number>>();
    actualDividends?.forEach((t) => {
      const asset = assetMap.get(t.source_asset_id) || assetMap.get(t.asset_id);
      const ticker = (t.metadata?.ticker as string) || asset?.ticker;
      if (ticker) {
        if (!receivedMonthsByTicker.has(ticker)) {
          receivedMonthsByTicker.set(ticker, new Set());
        }
        receivedMonthsByTicker.get(ticker)!.add(new Date(t.date).getMonth());
      }
    });

    // 6. Fetch dividend forecasts from findata for all stocks
    const tickersWithBalance = stockAssets
      .filter((s) => s.ticker && s.balance > 0)
      .map((s) => s.ticker!);

    if (tickersWithBalance.length > 0) {
      const dividendData = await findata.fetchDividendsBatch(tickersWithBalance, year);

      // Process findata dividends (both actual and forecasted)
      for (const stock of stockAssets) {
        if (!stock.ticker || stock.balance <= 0) continue;

        const tickerData = dividendData[stock.ticker];
        if (!tickerData || !tickerData.has_dividends) continue;

        const stockCurrency = tickerData.currency || stock.currency || 'USD';
        const frequency = mapFrequency(tickerData.frequency);
        const receivedMonths = receivedMonthsByTicker.get(stock.ticker) || new Set();

        // Process each dividend event from findata
        for (const div of tickerData.dividends) {
          // Skip if this month already has a DB dividend for this ticker
          if (receivedMonths.has(div.month)) continue;

          // Only include forecasted dividends from findata
          // (actual dividends come from DB above)
          if (!div.is_forecasted) continue;

          const forecastedAmount = div.amount * stock.balance;
          const converted = convertToPreferred(forecastedAmount, stockCurrency);

          months[div.month].dividends.push({
            ticker: stock.ticker,
            assetId: stock.id,
            amount: converted.amount,
            originalAmount: shouldConvert ? converted.original : undefined,
            originalCurrency: shouldConvert ? converted.originalCurrency : undefined,
            isForecasted: true,
            frequency,
            market: stock.market || null,
          });
          months[div.month].total += converted.amount;
        }
      }
    }

    // 6. Sort dividends within each month
    months.forEach((m) => {
      m.dividends.sort((a, b) => a.ticker.localeCompare(b.ticker));
    });

    // 7. Calculate annual total
    const annualTotal = months.reduce((sum, m) => sum + m.total, 0);

    res.json({
      success: true,
      data: {
        year,
        months,
        annualTotal,
        currency: shouldConvert ? preferredCurrency : 'USD',
        taxRate,
        taxRates,
        debug: {
          stockCount: stockAssets?.length || 0,
          dividendCount: actualDividends?.length || 0,
          historicalCount: 0, // No longer used - findata handles pattern detection
        },
      },
    });
  } catch (err) {
    console.error('getDividendCalendar error:', err);
    res.status(500).json({ success: false, error: 'Failed to get dividend calendar' });
  }
};
