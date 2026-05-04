/**
 * Dividend Sync Task
 *
 * Daily job. Syncs dividends from yfinance into the `dividends` table
 * for all portfolios with active holdings.
 *
 * Logic:
 * 1. Get all portfolios
 * 2. For each portfolio:
 *    a. Get all trades → compute current shares per ticker (buy-sell)
 *    b. For each ticker with shares > 0:
 *       - Fetch dividend calendar from findata (current year + previous year)
 *       - For each non-forecasted dividend event:
 *         * Compute shares_at_exdate: sum trades where date <= ex_date
 *         * Determine tax_rate by market
 *         * Upsert into dividends (skip if source = 'manual')
 * 3. Log summary
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as findata from '../src/utils/findata-client';

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

export class DividendSyncTask {
  private supabase: SupabaseClient;

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
  }

  async run(): Promise<void> {
    console.log('Starting dividend sync...');

    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;

    // 1. Get all portfolios
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

    let totalUpserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // 2. Process each portfolio
    for (const portfolio of portfolios as Portfolio[]) {
      console.log(`\nProcessing portfolio: ${portfolio.name} (${portfolio.id})`);

      // 2a. Get all trades for this portfolio
      const { data: trades, error: tradesError } = await this.supabase
        .from('trades')
        .select('id, portfolio_id, ticker, market, type, shares, price, currency, date')
        .eq('portfolio_id', portfolio.id)
        .order('date', { ascending: true });

      if (tradesError) {
        console.error(`  Failed to fetch trades for portfolio ${portfolio.id}: ${tradesError.message}`);
        totalErrors++;
        continue;
      }

      if (!trades || trades.length === 0) {
        console.log('  No trades found, skipping.');
        continue;
      }

      const typedTrades = trades as TradeRow[];

      // Compute current shares per ticker
      const tickerSharesMap = new Map<string, { shares: number; market: string }>();
      for (const trade of typedTrades) {
        const key = trade.ticker.toUpperCase();
        const current = tickerSharesMap.get(key) || { shares: 0, market: trade.market };
        const delta = trade.type === 'buy' ? Number(trade.shares) : -Number(trade.shares);
        tickerSharesMap.set(key, { shares: current.shares + delta, market: trade.market });
      }

      // Filter to tickers with shares > 0
      const activeTickers = [...tickerSharesMap.entries()].filter(([, v]) => v.shares > 0);
      console.log(`  Active tickers: ${activeTickers.map(([t]) => t).join(', ') || 'none'}`);

      // 2b. Process each active ticker
      for (const [ticker, { market }] of activeTickers) {
        try {
          // Fetch dividend data for current year and previous year
          for (const year of [previousYear, currentYear]) {
            const dividendData = await findata.fetchDividends(ticker, year);
            if (!dividendData || !dividendData.has_dividends) continue;

            for (const div of dividendData.dividends) {
              if (div.is_forecasted) continue;

              const exDate = div.date; // YYYY-MM-DD
              const amountPerShare = div.amount;
              const currency = dividendData.currency;

              // Compute shares_at_exdate
              const sharesAtExdate = this.computeSharesAtDate(typedTrades, ticker, exDate);
              if (sharesAtExdate <= 0) continue;

              const taxRate = this.getTaxRate(market);
              const grossAmount = sharesAtExdate * amountPerShare;
              const taxWithheld = grossAmount * taxRate;
              const totalAmount = grossAmount; // store gross; frontend applies tax via tax_rate

              // Check if existing record has source = 'manual' — skip if so
              const { data: existing } = await this.supabase
                .from('dividends')
                .select('id, source')
                .eq('portfolio_id', portfolio.id)
                .eq('ticker', ticker)
                .eq('ex_date', exDate)
                .maybeSingle();

              if (existing && existing.source === 'manual') {
                console.log(`  Skipping manual dividend: ${ticker} ex_date=${exDate}`);
                totalSkipped++;
                continue;
              }

              // Upsert
              const { error: upsertError } = await this.supabase
                .from('dividends')
                .upsert(
                  {
                    portfolio_id: portfolio.id,
                    ticker,
                    shares_at_exdate: sharesAtExdate,
                    amount_per_share: amountPerShare,
                    total_amount: totalAmount,
                    currency,
                    tax_rate: taxRate,
                    tax_withheld: taxWithheld,
                    ex_date: exDate,
                    pay_date: exDate, // findata only provides ex_date; pay_date approximated
                    source: 'auto',
                  },
                  { onConflict: 'portfolio_id,ticker,ex_date' }
                );

              if (upsertError) {
                console.error(`  Upsert failed for ${ticker} ex_date=${exDate}: ${upsertError.message}`);
                totalErrors++;
              } else {
                console.log(`  Upserted: ${ticker} ex_date=${exDate} shares=${sharesAtExdate.toFixed(4)} amt=${totalAmount.toFixed(4)} ${currency}`);
                totalUpserted++;
              }
            }
          }
        } catch (err) {
          console.error(`  Error processing ticker ${ticker}:`, err);
          totalErrors++;
        }
      }
    }

    console.log('\n========================================');
    console.log('  Dividend Sync Summary');
    console.log(`  Upserted : ${totalUpserted}`);
    console.log(`  Skipped  : ${totalSkipped} (manual entries)`);
    console.log(`  Errors   : ${totalErrors}`);
    console.log('========================================');
  }

  /**
   * Compute total shares for a ticker as of (and including) a given date.
   */
  private computeSharesAtDate(trades: TradeRow[], ticker: string, asOfDate: string): number {
    return trades
      .filter(t => t.ticker.toUpperCase() === ticker.toUpperCase() && t.date <= asOfDate)
      .reduce((sum, t) => {
        const qty = Number(t.shares);
        return t.type === 'buy' ? sum + qty : sum - qty;
      }, 0);
  }

  /**
   * Return the withholding tax rate for a given market.
   */
  private getTaxRate(market: string): number {
    switch (market?.toUpperCase()) {
      case 'US':
        return 0.30;
      case 'CN':
        return 0.10;
      case 'SGX':
      case 'HK':
      default:
        return 0.00;
    }
  }
}
