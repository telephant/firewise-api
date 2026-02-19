/**
 * Findata API Client
 *
 * Client for the firewise-findata service that provides financial data via yfinance.
 */

const FINDATA_BASE_URL = process.env.FINDATA_URL || 'http://localhost:8002';

interface StockPrice {
  ticker: string;
  price: number | null;
  previous_close: number | null;
  open: number | null;
  day_high: number | null;
  day_low: number | null;
  volume: number | null;
  market_cap: number | null;
  currency: string;
  change: number | null;
  change_percent: number | null;
  timestamp: string;
}

interface DividendEvent {
  date: string;
  month: number;
  month_name: string;
  amount: number;
  is_forecasted: boolean;
  source: string;
}

interface DividendData {
  ticker: string;
  year: number;
  has_dividends: boolean;
  frequency: string | null;
  payment_months: number[];
  dividends: DividendEvent[];
  annual_total_per_share: number;
  currency: string;
}

interface CAGRData {
  ticker: string;
  cagr_5y: number | null;
  cagr_10y: number | null;
  cagr_5y_percent: number | null;
  cagr_10y_percent: number | null;
  current_price: number | null;
  currency: string;
  data_points: number | null;
  years_of_data: number | null;
}

interface SymbolSearchResult {
  symbol: string;
  short_name: string | null;
  long_name: string | null;
  quote_type: string | null;
  exchange: string | null;
  exchange_display: string | null;
  sector: string | null;
  industry: string | null;
  score: number | null;
}

interface PriceAtDate {
  ticker: string;
  date: string;
  price: number | null;
  year: number;
  month: number;
  currency: string;
}

// In-memory cache with TTL
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// TTL constants (in milliseconds)
const TTL = {
  PRICE: 60 * 1000,          // 1 minute
  DIVIDEND: 60 * 60 * 1000,  // 1 hour
  CAGR: 24 * 60 * 60 * 1000, // 24 hours
  SEARCH: 5 * 60 * 1000,     // 5 minutes
};

/**
 * Fetch stock price for a single ticker
 */
export async function fetchStockPrice(ticker: string): Promise<StockPrice | null> {
  const cacheKey = `price:${ticker}`;
  const cached = getCached<StockPrice>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(`${FINDATA_BASE_URL}/stock/price/${ticker}`);
    if (!response.ok) return null;

    const data = await response.json() as StockPrice;
    setCached(cacheKey, data, TTL.PRICE);
    return data;
  } catch (error) {
    console.error(`Error fetching price for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch stock prices for multiple tickers (batch)
 */
export async function fetchStockPrices(tickers: string[]): Promise<Record<string, StockPrice>> {
  if (tickers.length === 0) return {};

  // Check cache first
  const results: Record<string, StockPrice> = {};
  const uncachedTickers: string[] = [];

  for (const ticker of tickers) {
    const cached = getCached<StockPrice>(`price:${ticker}`);
    if (cached) {
      results[ticker.toUpperCase()] = cached;
    } else {
      uncachedTickers.push(ticker);
    }
  }

  if (uncachedTickers.length === 0) return results;

  try {
    const response = await fetch(`${FINDATA_BASE_URL}/stock/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: uncachedTickers }),
    });

    if (!response.ok) return results;

    const data = await response.json() as { success: boolean; data: Record<string, StockPrice> };

    for (const [ticker, price] of Object.entries(data.data)) {
      results[ticker] = price;
      setCached(`price:${ticker}`, price, TTL.PRICE);
    }

    return results;
  } catch (error) {
    console.error('Error fetching batch prices:', error);
    return results;
  }
}

/**
 * Fetch dividends for a ticker (includes both actual and forecasted)
 */
export async function fetchDividends(ticker: string, year?: number): Promise<DividendData | null> {
  const targetYear = year || new Date().getFullYear();
  const cacheKey = `dividend:${ticker}:${targetYear}`;
  const cached = getCached<DividendData>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${FINDATA_BASE_URL}/dividend/${ticker}?year=${targetYear}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json() as DividendData;
    setCached(cacheKey, data, TTL.DIVIDEND);
    return data;
  } catch (error) {
    console.error(`Error fetching dividends for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch dividends for multiple tickers (batch)
 */
export async function fetchDividendsBatch(
  tickers: string[],
  year?: number
): Promise<Record<string, DividendData>> {
  if (tickers.length === 0) return {};

  const targetYear = year || new Date().getFullYear();

  try {
    const response = await fetch(`${FINDATA_BASE_URL}/dividend/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, year: targetYear }),
    });

    if (!response.ok) return {};

    const data = await response.json() as { success: boolean; data: Record<string, DividendData> };

    // Cache individual results
    for (const [ticker, dividendData] of Object.entries(data.data)) {
      setCached(`dividend:${ticker}:${targetYear}`, dividendData, TTL.DIVIDEND);
    }

    return data.data;
  } catch (error) {
    console.error('Error fetching batch dividends:', error);
    return {};
  }
}

/**
 * Fetch CAGR (5y and 10y) for a ticker
 */
export async function fetchCAGR(ticker: string): Promise<CAGRData | null> {
  const cacheKey = `cagr:${ticker}`;
  const cached = getCached<CAGRData>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(`${FINDATA_BASE_URL}/stock/cagr/${ticker}`);
    if (!response.ok) return null;

    const data = await response.json() as CAGRData;
    setCached(cacheKey, data, TTL.CAGR);
    return data;
  } catch (error) {
    console.error(`Error fetching CAGR for ${ticker}:`, error);
    return null;
  }
}

/**
 * Fetch CAGR for multiple tickers (batch)
 */
export async function fetchCAGRBatch(tickers: string[]): Promise<Record<string, CAGRData>> {
  if (tickers.length === 0) return {};

  try {
    const response = await fetch(`${FINDATA_BASE_URL}/stock/cagr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    });

    if (!response.ok) return {};

    const data = await response.json() as { success: boolean; data: Record<string, CAGRData> };

    // Cache individual results
    for (const [ticker, cagrData] of Object.entries(data.data)) {
      setCached(`cagr:${ticker}`, cagrData, TTL.CAGR);
    }

    return data.data;
  } catch (error) {
    console.error('Error fetching batch CAGR:', error);
    return {};
  }
}

/**
 * Search for symbols
 */
export async function searchSymbols(
  query: string,
  options?: { region?: string; type?: string; limit?: number }
): Promise<SymbolSearchResult[]> {
  const cacheKey = `search:${query}:${options?.region || ''}:${options?.type || ''}:${options?.limit || 10}`;
  const cached = getCached<SymbolSearchResult[]>(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({ q: query });
    if (options?.region) params.append('region', options.region);
    if (options?.type) params.append('type', options.type);
    if (options?.limit) params.append('limit', String(options.limit));

    const response = await fetch(`${FINDATA_BASE_URL}/search?${params}`);
    if (!response.ok) return [];

    const data = await response.json() as { success: boolean; results: SymbolSearchResult[] };
    setCached(cacheKey, data.results, TTL.SEARCH);
    return data.results;
  } catch (error) {
    console.error(`Error searching symbols for '${query}':`, error);
    return [];
  }
}

/**
 * Fetch price at a specific date (end of month)
 */
export async function fetchPriceAtDate(
  ticker: string,
  year: number,
  month: number
): Promise<PriceAtDate | null> {
  const cacheKey = `price-at:${ticker}:${year}:${month}`;
  const cached = getCached<PriceAtDate>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `${FINDATA_BASE_URL}/stock/price-at-date/${ticker}?year=${year}&month=${month}`
    );
    if (!response.ok) return null;

    const data = await response.json() as PriceAtDate;
    // Cache for longer since historical data doesn't change
    setCached(cacheKey, data, TTL.CAGR);
    return data;
  } catch (error) {
    console.error(`Error fetching price at date for ${ticker}:`, error);
    return null;
  }
}

/**
 * Check if findata service is healthy
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${FINDATA_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Export types
export type {
  StockPrice,
  DividendEvent,
  DividendData,
  CAGRData,
  SymbolSearchResult,
  PriceAtDate,
};
