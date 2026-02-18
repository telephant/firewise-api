import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse, Asset, Transaction } from '../types';
import { getViewContext, applyOwnershipFilter } from '../utils/family-context';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Dividend Calendar Controller
 *
 * Returns dividend calendar data with:
 * - Actual dividends from DB
 * - Forecasted dividends based on historical patterns (from DB or Yahoo Finance)
 */

type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

// In-memory cache for Yahoo Finance dividend data (TTL: 24 hours)
interface CachedDividendData {
  events: DividendEvent[];
  cachedAt: number;
}
const dividendCache = new Map<string, CachedDividendData>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCachedDividends(ticker: string): DividendEvent[] | null {
  const cached = dividendCache.get(ticker);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.events;
  }
  return null;
}

function setCachedDividends(ticker: string, events: DividendEvent[]): void {
  dividendCache.set(ticker, { events, cachedAt: Date.now() });
}

interface DividendEvent {
  date: Date;
  amount: number; // dividend per share
}

interface DividendPattern {
  frequency: ScheduleFrequency | null;
  paymentMonths: number[]; // 0-11
  lastDividendPerShare: number;
}

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
 * Fetch dividend history from Yahoo Finance API
 */
async function fetchYahooDividendHistory(
  ticker: string,
  startDate: Date,
  endDate: Date
): Promise<DividendEvent[]> {
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?events=div&period1=${period1}&period2=${period2}&interval=1mo`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.warn(`Yahoo Finance API returned ${response.status} for ${ticker}`);
      return [];
    }

    const data = await response.json() as {
      chart?: {
        result?: Array<{
          events?: {
            dividends?: Record<string, { amount: number; date: number }>;
          };
        }>;
      };
    };
    const dividends = data?.chart?.result?.[0]?.events?.dividends;

    if (!dividends) {
      return [];
    }

    return Object.values(dividends).map((d) => ({
      date: new Date(d.date * 1000),
      amount: d.amount,
    }));
  } catch (error) {
    console.error(`Failed to fetch dividend history for ${ticker}:`, error);
    return [];
  }
}

/**
 * Detect dividend frequency from historical payment dates
 */
function detectFrequency(dividendDates: Date[]): ScheduleFrequency | null {
  if (dividendDates.length < 2) return null;

  const sorted = [...dividendDates].sort((a, b) => a.getTime() - b.getTime());

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const monthsDiff =
      (sorted[i].getFullYear() - sorted[i - 1].getFullYear()) * 12 +
      (sorted[i].getMonth() - sorted[i - 1].getMonth());
    gaps.push(monthsDiff);
  }

  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

  if (avgGap <= 0.5) return 'weekly';
  if (avgGap <= 0.75) return 'biweekly';
  if (avgGap <= 1.5) return 'monthly';
  if (avgGap <= 4) return 'quarterly';
  return 'yearly';
}

/**
 * Get the typical payment months based on historical data
 */
function getPaymentMonths(dividendDates: Date[], frequency: ScheduleFrequency): number[] {
  const monthCounts = new Map<number, number>();
  dividendDates.forEach((d) => {
    const month = d.getMonth();
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  });

  const sorted = [...monthCounts.entries()].sort((a, b) => b[1] - a[1]);

  switch (frequency) {
    case 'weekly':
    case 'biweekly':
    case 'monthly':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    case 'quarterly':
      return sorted.slice(0, 4).map(([m]) => m);
    case 'yearly':
      return sorted.slice(0, 1).map(([m]) => m);
    default:
      return sorted.map(([m]) => m);
  }
}

/**
 * Analyze dividend data to detect payment pattern
 */
function detectDividendPattern(dividendEvents: DividendEvent[]): DividendPattern {
  if (dividendEvents.length === 0) {
    return { frequency: null, paymentMonths: [], lastDividendPerShare: 0 };
  }

  const dates = dividendEvents.map((e) => e.date);
  const frequency = detectFrequency(dates);
  const paymentMonths = frequency ? getPaymentMonths(dates, frequency) : [];

  const sortedByDate = [...dividendEvents].sort((a, b) => b.date.getTime() - a.date.getTime());
  const lastDividendPerShare = sortedByDate[0]?.amount || 0;

  return { frequency, paymentMonths, lastDividendPerShare };
}

/**
 * Check if we have enough local data to skip Yahoo Finance API
 */
function hasEnoughLocalData(dividendCount: number): boolean {
  return dividendCount >= 4;
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
    assetsQuery = applyOwnershipFilter(assetsQuery, viewContext);

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
    dividendsQuery = applyOwnershipFilter(dividendsQuery, viewContext);

    const { data: actualDividends, error: dividendsError } = await dividendsQuery;

    if (dividendsError) {
      console.error('Failed to fetch dividends:', dividendsError);
    }

    // 3. Get historical dividends (2 years) for pattern detection
    let historicalQuery = supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('type', 'income')
      .eq('category', 'dividend')
      .gte('date', `${year - 2}-01-01`)
      .lte('date', `${year}-12-31`);
    historicalQuery = applyOwnershipFilter(historicalQuery, viewContext);

    const { data: historicalDividends } = await historicalQuery;

    // 4. Collect currencies and get exchange rates
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

    // 5. Add actual dividends to months
    actualDividends?.forEach((t) => {
      const month = new Date(t.date).getMonth();
      const asset = assetMap.get(t.source_asset_id) || assetMap.get(t.asset_id);
      const ticker = (t.metadata?.ticker as string) || asset?.ticker || 'Unknown';
      const dividendCurrency = t.currency || 'USD';

      const converted = convertToPreferred(t.amount, dividendCurrency);

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

    // 5. Generate forecasts for each stock (in parallel)
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    // Prepare stocks that need Yahoo data
    const stocksNeedingYahoo: Array<{ stock: Asset; localDividends: Transaction[] }> = [];
    const stocksWithLocalData: Array<{ stock: Asset; dividendEvents: DividendEvent[] }> = [];

    for (const stock of stockAssets) {
      if (!stock.ticker || stock.balance <= 0) continue;

      const localDividends = historicalDividends?.filter(
        (t) => t.source_asset_id === stock.id || t.asset_id === stock.id
      ) || [];

      if (hasEnoughLocalData(localDividends.length)) {
        // Use local DB data
        const dividendEvents = localDividends.map((t) => ({
          date: new Date(t.date),
          amount: (t.metadata?.dividend_per_share as number) || t.amount / (stock.balance || 1),
        }));
        stocksWithLocalData.push({ stock, dividendEvents });
      } else {
        stocksNeedingYahoo.push({ stock, localDividends });
      }
    }

    // Fetch Yahoo data in parallel for stocks that need it
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const yahooResults = await Promise.all(
      stocksNeedingYahoo.map(async ({ stock }) => {
        try {
          // Check cache first
          const cached = getCachedDividends(stock.ticker!);
          if (cached) {
            return { stock, dividendEvents: cached };
          }

          // Fetch from Yahoo and cache
          const dividendEvents = await fetchYahooDividendHistory(stock.ticker!, twoYearsAgo, new Date());
          setCachedDividends(stock.ticker!, dividendEvents);
          return { stock, dividendEvents };
        } catch (error) {
          console.error(`Failed to fetch Yahoo data for ${stock.ticker}:`, error);
          return { stock, dividendEvents: [] as DividendEvent[] };
        }
      })
    );

    // Combine all stocks with their dividend data
    const allStocksWithData = [...stocksWithLocalData, ...yahooResults];

    // Process forecasts
    for (const { stock, dividendEvents } of allStocksWithData) {
      const pattern = detectDividendPattern(dividendEvents);

      if (!pattern.frequency || pattern.paymentMonths.length === 0) continue;

      // Get months already received this year
      const receivedMonths = new Set<number>();
      actualDividends?.forEach((t) => {
        if (t.source_asset_id === stock.id || t.asset_id === stock.id) {
          receivedMonths.add(new Date(t.date).getMonth());
        }
      });

      // Predict future dividends
      // Stock currency determines dividend currency (US stocks pay in USD)
      const stockCurrency = stock.currency || 'USD';

      for (const month of pattern.paymentMonths) {
        if (receivedMonths.has(month)) continue;
        if (year === currentYear && month <= currentMonth) continue;
        if (year < currentYear) continue;

        // Always return gross amounts - tax calculation done on frontend
        const forecastedAmount = pattern.lastDividendPerShare * stock.balance;
        const converted = convertToPreferred(forecastedAmount, stockCurrency);

        months[month].dividends.push({
          ticker: stock.ticker!,
          assetId: stock.id,
          amount: converted.amount,
          originalAmount: shouldConvert ? converted.original : undefined,
          originalCurrency: shouldConvert ? converted.originalCurrency : undefined,
          isForecasted: true,
          frequency: pattern.frequency,
          market: stock.market || null,
        });
        months[month].total += converted.amount;
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
          historicalCount: historicalDividends?.length || 0,
        },
      },
    });
  } catch (err) {
    console.error('getDividendCalendar error:', err);
    res.status(500).json({ success: false, error: 'Failed to get dividend calendar' });
  }
};
