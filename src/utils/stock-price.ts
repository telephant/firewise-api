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
