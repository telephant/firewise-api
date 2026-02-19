/**
 * Shared stock price fetching utility
 *
 * Uses firewise-findata service for all stock data.
 */

import * as findata from './findata-client';

/**
 * Fetch stock price (with caching handled by findata client)
 */
export async function fetchStockPrice(symbol: string): Promise<{ price: number; currency: string } | null> {
  const data = await findata.fetchStockPrice(symbol);
  if (!data || data.price === null) return null;

  return { price: data.price, currency: data.currency };
}

/**
 * Fetch multiple stock prices in parallel
 */
export async function fetchStockPrices(symbols: string[]): Promise<Map<string, { price: number; currency: string }>> {
  const uniqueSymbols = [...new Set(symbols)];
  if (uniqueSymbols.length === 0) return new Map();

  const data = await findata.fetchStockPrices(uniqueSymbols);

  const priceMap = new Map<string, { price: number; currency: string }>();
  for (const [ticker, priceData] of Object.entries(data)) {
    if (priceData.price !== null) {
      priceMap.set(ticker, { price: priceData.price, currency: priceData.currency });
    }
  }

  return priceMap;
}

/**
 * Fetch historical stock price at end of a specific month
 */
export async function fetchHistoricalPrice(
  symbol: string,
  year: number,
  month: number // 1-12
): Promise<{ price: number; currency: string } | null> {
  const data = await findata.fetchPriceAtDate(symbol, year, month);
  if (!data || data.price === null) return null;

  return { price: data.price, currency: data.currency };
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
