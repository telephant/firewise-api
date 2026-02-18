/**
 * Shared stock price fetching utility with caching
 */

// Cache for stock prices (5 minute TTL)
const stockPriceCache = new Map<string, { price: number; currency: string; timestamp: number }>();
const STOCK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch stock price from Yahoo Finance (with caching)
 */
export async function fetchStockPrice(symbol: string): Promise<{ price: number; currency: string } | null> {
  try {
    // Check cache first
    const cached = stockPriceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < STOCK_CACHE_TTL) {
      return { price: cached.price, currency: cached.currency };
    }

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${oneDayAgo}&period2=${now}&interval=1d`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      chart?: {
        error?: unknown;
        result?: Array<{ meta: { regularMarketPrice: number; currency?: string } }>;
      };
    };
    if (data.chart?.error || !data.chart?.result?.[0]) return null;

    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const currency = meta.currency || 'USD';

    // Cache the result
    stockPriceCache.set(symbol, { price, currency, timestamp: Date.now() });

    return { price, currency };
  } catch {
    return null;
  }
}

/**
 * Fetch multiple stock prices in parallel (with caching)
 */
export async function fetchStockPrices(symbols: string[]): Promise<Map<string, { price: number; currency: string }>> {
  const uniqueSymbols = [...new Set(symbols)];
  const pricePromises = uniqueSymbols.map(ticker => fetchStockPrice(ticker));
  const priceResults = await Promise.all(pricePromises);

  const priceMap = new Map<string, { price: number; currency: string }>();
  uniqueSymbols.forEach((ticker, index) => {
    if (priceResults[index]) {
      priceMap.set(ticker, priceResults[index]!);
    }
  });

  return priceMap;
}

// Cache for historical stock prices (1 hour TTL since historical data doesn't change)
const historicalPriceCache = new Map<string, { price: number; currency: string; timestamp: number }>();
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch historical stock price at end of a specific month from Yahoo Finance
 * Returns the closing price on the last trading day of the month
 */
export async function fetchHistoricalPrice(
  symbol: string,
  year: number,
  month: number // 1-12
): Promise<{ price: number; currency: string } | null> {
  const cacheKey = `${symbol}-${year}-${month}`;

  try {
    // Check cache first
    const cached = historicalPriceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < HISTORICAL_CACHE_TTL) {
      return { price: cached.price, currency: cached.currency };
    }

    // Calculate date range: start of month to end of month
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0); // Last day of month

    // Add buffer days to ensure we get trading days
    const period1 = Math.floor(new Date(year, month - 1, 15).getTime() / 1000); // Mid month
    const period2 = Math.floor(new Date(year, month, 5).getTime() / 1000); // 5 days into next month

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      chart?: {
        error?: unknown;
        result?: Array<{
          meta: { currency?: string };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ close?: (number | null)[] }>;
          };
        }>;
      };
    };

    if (data.chart?.error || !data.chart?.result?.[0]) return null;

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const currency = result.meta.currency || 'USD';

    // Find the last trading day that's still in the target month
    const lastDayOfMonth = endOfMonth.getDate();
    let lastPrice: number | null = null;

    for (let i = timestamps.length - 1; i >= 0; i--) {
      const date = new Date(timestamps[i] * 1000);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() <= lastDayOfMonth) {
        if (closes[i] !== null && closes[i] !== undefined) {
          lastPrice = closes[i]!;
          break;
        }
      }
    }

    if (lastPrice === null) {
      // Fallback: get the most recent price before end of month
      for (let i = closes.length - 1; i >= 0; i--) {
        const date = new Date(timestamps[i] * 1000);
        if (date <= endOfMonth && closes[i] !== null && closes[i] !== undefined) {
          lastPrice = closes[i]!;
          break;
        }
      }
    }

    if (lastPrice === null) return null;

    // Cache the result
    historicalPriceCache.set(cacheKey, { price: lastPrice, currency, timestamp: Date.now() });

    return { price: lastPrice, currency };
  } catch (err) {
    console.error(`Failed to fetch historical price for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch historical prices for multiple symbols at end of a specific month
 */
export async function fetchHistoricalPrices(
  symbols: string[],
  year: number,
  month: number
): Promise<Map<string, { price: number; currency: string }>> {
  const uniqueSymbols = [...new Set(symbols)];
  const pricePromises = uniqueSymbols.map(ticker => fetchHistoricalPrice(ticker, year, month));
  const priceResults = await Promise.all(pricePromises);

  const priceMap = new Map<string, { price: number; currency: string }>();
  uniqueSymbols.forEach((ticker, index) => {
    if (priceResults[index]) {
      priceMap.set(ticker, priceResults[index]!);
    }
  });

  return priceMap;
}
