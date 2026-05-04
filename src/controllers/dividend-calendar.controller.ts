import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getViewContext } from '../utils/family-context';
import { getExchangeRates, convertAmount } from '../utils/currency-conversion';
import { computePositions } from '../utils/portfolio-calc';
import { Trade, Dividend } from '../types/portfolio';
import * as findata from '../utils/findata-client';

/**
 * Dividend Calendar Controller
 *
 * Returns dividend calendar data with:
 * - Actual dividends from dividends table
 * - Forecasted dividends from findata service (via yfinance), for current holdings
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
  market?: string | null;
}

interface MonthData {
  month: number;
  name: string;
  dividends: MonthDividend[];
  total: number;
}

interface TaxRates {
  us: number;
  sg: number;
}

interface DividendCalendarResponse {
  year: number;
  months: MonthData[];
  annualTotal: number;
  currency: string;
  taxRate: number; // @deprecated - use taxRates instead
  taxRates: TaxRates;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
 * Get dividend calendar data for a specific year, aggregated across all portfolios.
 */
export const getDividendCalendar = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DividendCalendarResponse>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    // Tax settings
    const { data: taxSettings } = await supabaseAdmin
      .from('user_tax_settings')
      .select('us_dividend_withholding_rate, sg_dividend_withholding_rate')
      .eq('user_id', userId)
      .single();

    const taxRates: TaxRates = {
      us: taxSettings?.us_dividend_withholding_rate ?? 0.30,
      sg: taxSettings?.sg_dividend_withholding_rate ?? 0.00,
    };
    const taxRate = taxRates.us;

    // Initialize months
    const months: MonthData[] = MONTH_NAMES.map((name, index) => ({
      month: index,
      name,
      dividends: [],
      total: 0,
    }));

    // 1. Get all portfolios for this family
    const { data: portfolios, error: portfoliosError } = await supabaseAdmin
      .from('portfolios')
      .select('id, currency')
      .eq('belong_id', viewContext.belongId);

    if (portfoliosError) {
      console.error('Failed to fetch portfolios:', portfoliosError);
      res.status(500).json({ success: false, error: 'Failed to fetch portfolios' });
      return;
    }

    if (!portfolios || portfolios.length === 0) {
      res.json({
        success: true,
        data: { year, months, annualTotal: 0, currency: 'USD', taxRate, taxRates },
      });
      return;
    }

    const portfolioIds = portfolios.map((p) => p.id);

    // 2. Get actual dividends for the year across all portfolios
    const { data: actualDividends, error: dividendsError } = await supabaseAdmin
      .from('dividends')
      .select('*')
      .in('portfolio_id', portfolioIds)
      .gte('ex_date', `${year}-01-01`)
      .lte('ex_date', `${year}-12-31`);

    if (dividendsError) {
      console.error('Failed to fetch dividends:', dividendsError);
    }

    // 3. Get all trades across all portfolios (for computing current holdings for forecasts)
    const { data: allTrades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('*')
      .in('portfolio_id', portfolioIds)
      .order('date', { ascending: true });

    if (tradesError) {
      console.error('Failed to fetch trades:', tradesError);
    }

    // 4. Determine preferred currency (use first portfolio's currency, or USD)
    const preferredCurrency = portfolios[0]?.currency || 'USD';

    // Collect currencies for exchange rate lookup
    const currencies = new Set<string>([preferredCurrency.toLowerCase()]);
    (actualDividends || []).forEach((d) => currencies.add((d.currency || 'USD').toLowerCase()));

    // For now: no currency conversion (return in original currency, same as dividends table)
    const rateMap = new Map<string, number>();

    const convertToPreferred = (amount: number, fromCurrency: string) => {
      if (fromCurrency.toLowerCase() === preferredCurrency.toLowerCase()) {
        return { amount, original: amount, originalCurrency: fromCurrency };
      }
      const result = convertAmount(amount, fromCurrency, preferredCurrency, rateMap);
      return {
        amount: result?.converted ?? amount,
        original: amount,
        originalCurrency: fromCurrency,
      };
    };

    // 5. Add actual dividends to months (gross amount; frontend applies tax)
    (actualDividends || []).forEach((d: Dividend) => {
      const month = new Date(d.ex_date).getMonth();
      const converted = convertToPreferred(d.total_amount, d.currency);

      months[month].dividends.push({
        ticker: d.ticker,
        assetId: d.portfolio_id, // use portfolio_id as reference
        amount: converted.amount,
        isForecasted: false,
        date: d.ex_date,
      });
      months[month].total += converted.amount;
    });

    // Track which months already have actual dividends per ticker (to avoid double-counting with forecasts)
    const receivedMonthsByTicker = new Map<string, Set<number>>();
    (actualDividends || []).forEach((d: Dividend) => {
      if (!receivedMonthsByTicker.has(d.ticker)) {
        receivedMonthsByTicker.set(d.ticker, new Set());
      }
      receivedMonthsByTicker.get(d.ticker)!.add(new Date(d.ex_date).getMonth());
    });

    // 6. Compute current holdings from trades for forecasting
    const tradeList: Trade[] = (allTrades || []) as Trade[];
    const positions = computePositions(tradeList);
    const activePositions = Array.from(positions.entries())
      .filter(([, pos]) => pos.shares > 0 && pos.shares > 0.0001);

    if (activePositions.length > 0) {
      const activeTickers = activePositions.map(([ticker]) => ticker);
      const dividendData = await findata.fetchDividendsBatch(activeTickers, year);

      for (const [ticker, pos] of activePositions) {
        const tickerData = dividendData[ticker];
        if (!tickerData || !tickerData.has_dividends) continue;

        const stockCurrency = tickerData.currency || 'USD';
        const frequency = mapFrequency(tickerData.frequency);
        const receivedMonths = receivedMonthsByTicker.get(ticker) || new Set();

        for (const div of tickerData.dividends) {
          if (receivedMonths.has(div.month)) continue;
          if (!div.is_forecasted) continue;

          const forecastedAmount = div.amount * pos.shares;
          const converted = convertToPreferred(forecastedAmount, stockCurrency);

          months[div.month].dividends.push({
            ticker,
            assetId: '',
            amount: converted.amount,
            isForecasted: true,
            frequency,
            market: null,
          });
          months[div.month].total += converted.amount;
        }
      }
    }

    // 7. Sort dividends within each month
    months.forEach((m) => {
      m.dividends.sort((a, b) => a.ticker.localeCompare(b.ticker));
    });

    const annualTotal = months.reduce((sum, m) => sum + m.total, 0);

    res.json({
      success: true,
      data: { year, months, annualTotal, currency: preferredCurrency, taxRate, taxRates },
    });
  } catch (err) {
    console.error('getDividendCalendar error:', err);
    res.status(500).json({ success: false, error: 'Failed to get dividend calendar' });
  }
};
