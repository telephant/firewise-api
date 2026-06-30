/**
 * Portfolio Snapshot Task
 *
 * Month-end snapshot job. Run on the 1st of each month to capture the
 * previous month's portfolio state.
 *
 * Usage:
 *   npx ts-node tasks/index.ts portfolio-snapshot
 *   npx ts-node tasks/index.ts portfolio-snapshot --month=2024-03
 *
 * Logic:
 * 1. Determine target month (previous month by default, or --month=YYYY-MM)
 * 2. Compute snapshot_date = last day of target month
 * 3. For each portfolio:
 *    a. Get all trades up to snapshot_date
 *    b. Compute positions using average cost method
 *    c. Fetch/cache prices for open positions
 *    d. Compute totals and upsert into portfolio_snapshots
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as findata from '../src/utils/findata-client';
import { getExchangeRates, convertAmount } from '../src/utils/currency-conversion';

dotenv.config();

interface Portfolio {
  id: string;
  belong_id: string;
  name: string;
  currency: string;
}

interface TradeRow {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string; // YYYY-MM-DD
}

interface Position {
  shares: number;
  avg_cost: number;
  realized_pl: number;
}

export class PortfolioSnapshotTask {
  private supabase: SupabaseClient;
  private targetYear: number;
  private targetMonth: number; // 1-12

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse --month=YYYY-MM from process.argv if present
    const monthArg = process.argv.find(arg => arg.startsWith('--month='));
    if (monthArg) {
      const [year, month] = monthArg.replace('--month=', '').split('-').map(Number);
      if (!year || !month || month < 1 || month > 12) {
        throw new Error(`Invalid --month argument: ${monthArg}. Expected format: --month=YYYY-MM`);
      }
      this.targetYear = year;
      this.targetMonth = month;
    } else {
      // Default: previous month
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      this.targetYear = prev.getFullYear();
      this.targetMonth = prev.getMonth() + 1; // 1-12
    }
  }

  async run(): Promise<void> {
    const monthStr = `${this.targetYear}-${String(this.targetMonth).padStart(2, '0')}`;
    const snapshotDate = this.getLastDayOfMonth(this.targetYear, this.targetMonth);

    console.log(`Starting portfolio snapshot for ${monthStr} (snapshot_date=${snapshotDate})...`);

    // Get all portfolios
    const { data: portfolios, error: portfolioError } = await this.supabase
      .from('portfolios')
      .select('id, belong_id, name, currency');

    if (portfolioError) {
      throw new Error(`Failed to fetch portfolios: ${portfolioError.message}`);
    }

    if (!portfolios || portfolios.length === 0) {
      console.log('No portfolios found. Exiting.');
      return;
    }

    console.log(`Found ${portfolios.length} portfolio(s)`);

    let totalSnapshots = 0;
    let totalErrors = 0;

    for (const portfolio of portfolios as Portfolio[]) {
      console.log(`\nProcessing portfolio: ${portfolio.name} (${portfolio.id})`);

      try {
        // Get all trades up to (and including) snapshot_date
        const { data: trades, error: tradesError } = await this.supabase
          .from('trades')
          .select('id, portfolio_id, ticker, market, type, shares, price, currency, date')
          .eq('portfolio_id', portfolio.id)
          .lte('date', snapshotDate)
          .order('date', { ascending: true });

        if (tradesError) {
          throw new Error(`Failed to fetch trades: ${tradesError.message}`);
        }

        if (!trades || trades.length === 0) {
          console.log('  No trades found up to snapshot date, skipping.');
          continue;
        }

        const typedTrades = trades as TradeRow[];

        // Compute positions using average cost method
        const positions = this.computePositions(typedTrades);

        // Build ticker→currency map from trades (trade currency is authoritative for cost basis)
        const tickerCurrency = new Map<string, string>();
        for (const trade of typedTrades) {
          tickerCurrency.set(trade.ticker.toUpperCase(), trade.currency || 'USD');
        }

        // Build snapshot detail and compute totals in USD
        let totalCost = 0;
        let totalValue = 0;
        let totalRealizedPl = 0;
        const detail: Array<{
          ticker: string;
          shares: number;
          price: number;
          price_currency: string;
          value: number;
          value_usd: number;
          cost: number;
          cost_usd: number;
          unrealized_pl: number;
          unrealized_pl_usd: number;
        }> = [];

        // Collect all currencies involved (both open and closed positions) for batch rate fetch
        const involvedCurrencies = new Set<string>(['usd']);
        for (const ticker of positions.keys()) {
          const tradeCurr = (tickerCurrency.get(ticker) || 'USD').toLowerCase();
          involvedCurrencies.add(tradeCurr);
        }
        const rateMap = await getExchangeRates(Array.from(involvedCurrencies));

        // Helper: convert any amount to USD, returns 0 and logs if rate missing
        const toUSD = (amount: number, fromCurrency: string): number => {
          if (fromCurrency.toLowerCase() === 'usd') return amount;
          const result = convertAmount(amount, fromCurrency, 'USD', rateMap);
          if (!result) {
            console.warn(`  [snapshot] Missing rate for ${fromCurrency} → USD; treating as 0`);
            return 0;
          }
          return result.converted;
        };

        for (const [ticker, pos] of positions.entries()) {
          if (pos.shares <= 0) {
            const tradeCurr = tickerCurrency.get(ticker) || 'USD';
            totalRealizedPl += toUSD(pos.realized_pl, tradeCurr);
            continue;
          }

          // Try price_cache first
          let price = await this.getPriceCached(ticker, snapshotDate);
          let priceCurrency = tickerCurrency.get(ticker) || 'USD';

          // If not in cache, fetch from findata
          if (price === null) {
            const priceData = await findata.fetchPriceAtDate(ticker, this.targetYear, this.targetMonth);
            if (priceData && priceData.price !== null) {
              price = priceData.price;
              if (priceData.currency) priceCurrency = priceData.currency;
              await this.cachePrice(ticker, snapshotDate, price, priceCurrency);
              // Update rateMap if findata returned a new currency
              if (!rateMap.has(priceCurrency.toLowerCase()) && priceCurrency.toLowerCase() !== 'usd') {
                const newRates = await getExchangeRates([priceCurrency.toLowerCase()]);
                newRates.forEach((v, k) => rateMap.set(k, v));
              }
            }
          }

          const tradeCurr = tickerCurrency.get(ticker) || 'USD';
          // Fall back to avg_cost (in trade currency) if no price available
          const effectivePrice = price !== null ? price : pos.avg_cost;
          const cost = pos.shares * pos.avg_cost;         // in trade currency
          const value = pos.shares * effectivePrice;      // in price currency
          const costUsd = toUSD(cost, tradeCurr);
          const valueUsd = toUSD(value, priceCurrency);
          const unrealizedPl = value - cost;              // native (only meaningful if same currency)
          const unrealizedPlUsd = valueUsd - costUsd;

          totalCost += costUsd;
          totalValue += valueUsd;
          totalRealizedPl += toUSD(pos.realized_pl, tradeCurr);

          detail.push({
            ticker,
            shares: pos.shares,
            price: effectivePrice,
            price_currency: priceCurrency,
            value,
            value_usd: valueUsd,
            cost,
            cost_usd: costUsd,
            unrealized_pl: unrealizedPl,
            unrealized_pl_usd: unrealizedPlUsd,
          });
        }

        const unrealizedPl = totalValue - totalCost; // both in USD now

        console.log(`  Positions: ${detail.length}, total_value_usd=${totalValue.toFixed(2)}, total_cost_usd=${totalCost.toFixed(2)}, unrealized_pl_usd=${unrealizedPl.toFixed(2)}, realized_pl_usd=${totalRealizedPl.toFixed(2)}`);

        // Upsert into portfolio_snapshots — all monetary totals are in USD
        const { error: upsertError } = await this.supabase
          .from('portfolio_snapshots')
          .upsert(
            {
              portfolio_id: portfolio.id,
              snapshot_date: snapshotDate,
              total_value: totalValue,
              total_cost: totalCost,
              unrealized_pl: unrealizedPl,
              realized_pl: totalRealizedPl,
              currency: 'USD', // always USD now; per-ticker native amounts are in detail[]
              detail,
            },
            { onConflict: 'portfolio_id,snapshot_date' }
          );

        if (upsertError) {
          throw new Error(`Failed to upsert snapshot: ${upsertError.message}`);
        }

        console.log(`  Snapshot upserted for ${portfolio.name} on ${snapshotDate}`);
        totalSnapshots++;
      } catch (err) {
        console.error(`  Error processing portfolio ${portfolio.id}:`, err);
        totalErrors++;
      }
    }

    console.log('\n========================================');
    console.log('  Portfolio Snapshot Summary');
    console.log(`  Snapshots upserted : ${totalSnapshots}`);
    console.log(`  Errors             : ${totalErrors}`);
    console.log('========================================');
  }

  /**
   * Compute positions using average cost method.
   */
  private computePositions(trades: TradeRow[]): Map<string, Position> {
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    const positions = new Map<string, Position>();

    for (const trade of sorted) {
      const key = trade.ticker.toUpperCase();
      const pos = positions.get(key) || { shares: 0, avg_cost: 0, realized_pl: 0 };
      const qty = Number(trade.shares);
      const px = Number(trade.price);

      if (trade.type === 'buy') {
        const newShares = pos.shares + qty;
        pos.avg_cost = (pos.shares * pos.avg_cost + qty * px) / newShares;
        pos.shares = newShares;
      } else {
        pos.realized_pl += (px - pos.avg_cost) * qty;
        pos.shares = Math.max(0, pos.shares - qty);
      }

      positions.set(key, pos);
    }

    return positions;
  }

  /**
   * Try to get a cached price for a ticker on a specific date.
   * Returns null if not found in price_cache.
   */
  private async getPriceCached(ticker: string, date: string): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('price_cache')
      .select('price')
      .eq('ticker', ticker)
      .eq('date', date)
      .maybeSingle();

    if (error || !data) return null;
    return data.price;
  }

  /**
   * Store a fetched price in price_cache.
   */
  private async cachePrice(ticker: string, date: string, price: number, currency: string): Promise<void> {
    const { error } = await this.supabase
      .from('price_cache')
      .upsert(
        {
          ticker,
          date,
          price,
          currency,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'ticker,date' }
      );

    if (error) {
      console.warn(`  Warning: failed to cache price for ${ticker} on ${date}: ${error.message}`);
    }
  }

  /**
   * Get the last day of a given month as YYYY-MM-DD string.
   */
  private getLastDayOfMonth(year: number, month: number): string {
    // Day 0 of next month = last day of current month
    const lastDay = new Date(year, month, 0);
    const mm = String(lastDay.getMonth() + 1).padStart(2, '0');
    const dd = String(lastDay.getDate()).padStart(2, '0');
    return `${lastDay.getFullYear()}-${mm}-${dd}`;
  }
}
