/**
 * Check Dividends Task
 *
 * Checks for dividend payment dates for US stocks/ETFs held by users and
 * automatically creates income transactions for dividends that are paid.
 *
 * Logic:
 * 1. Get all users with US stock/ETF holdings (type='stock' or 'etf', market='US')
 * 2. For each stock, fetch dividend data from Yahoo Finance API
 * 3. Check if today is a payment date for any dividend
 * 4. For each matching dividend:
 *    - Check for duplicates (same source_asset_id + date + category='dividend')
 *    - Calculate gross amount: shares × dividend_per_share
 *    - Apply tax withholding and currency conversion
 *    - Create income transaction with needs_review=true
 *    - Update cash asset balance
 *
 * API: Yahoo Finance (no API key required)
 * https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?events=div
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getExchangeRates, convertAmount } from '../src/utils/currency-conversion';

dotenv.config();

interface Asset {
  id: string;
  user_id: string;
  belong_id: string;
  name: string;
  ticker: string;
  balance: number;
  currency: string;
}

interface UserAsset extends Asset {
  primary_cash_asset_id: string | null;
}

interface UserTaxSettings {
  us_dividend_withholding_rate: number;
}

interface YahooDividend {
  amount: number;
  date: number; // Unix timestamp
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        symbol: string;
      };
      events?: {
        dividends?: Record<string, YahooDividend>;
      };
    }>;
    error?: {
      code: string;
      description: string;
    };
  };
}

export class CheckDividendsTask {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async run(): Promise<void> {
    console.log('Checking for dividend payments...');

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    console.log(`Today: ${today}`);

    // Get all US stock assets with their user info
    const stockAssets = await this.getUSStockAssets();
    console.log(`Found ${stockAssets.length} US stock holdings to check`);

    if (stockAssets.length === 0) {
      console.log('No US stocks to check for dividends');
      return;
    }

    // Group by ticker to avoid duplicate API calls
    const tickerMap = new Map<string, UserAsset[]>();
    for (const asset of stockAssets) {
      const ticker = asset.ticker.toUpperCase();
      if (!tickerMap.has(ticker)) {
        tickerMap.set(ticker, []);
      }
      tickerMap.get(ticker)!.push(asset);
    }

    console.log(`Checking ${tickerMap.size} unique tickers`);

    let dividendsCreated = 0;
    let duplicatesSkipped = 0;

    // Check each ticker for dividends
    for (const [ticker, assets] of tickerMap) {
      try {
        // Fetch all paid dividends in the last 30 days
        const dividends = await this.fetchPaidDividends(ticker, today);

        if (dividends.length === 0) {
          continue;
        }

        console.log(`  ${ticker}: Found ${dividends.length} dividend(s)`);

        // Process each dividend
        for (const dividend of dividends) {
          const dividendDate = new Date(dividend.date * 1000).toISOString().split('T')[0];
          console.log(`    Payment date: ${dividendDate}, Amount: $${dividend.amount.toFixed(4)} per share`);

          // Create dividend flows for each user holding this stock
          for (const asset of assets) {
            const isDuplicate = await this.checkDuplicateDividend(asset.id, dividendDate);

            if (isDuplicate) {
              console.log(`      Skipping duplicate for user ${asset.user_id.slice(0, 8)}...`);
              duplicatesSkipped++;
              continue;
            }

            // Calculate gross dividend amount (in USD)
            const grossAmountUsd = asset.balance * dividend.amount;

            // Get user's tax settings and primary cash asset in parallel
            const [taxSettings, primaryCashAsset] = await Promise.all([
              this.getUserTaxSettings(asset.user_id),
              this.getPrimaryCashAsset(asset.user_id),
            ]);

            if (!primaryCashAsset) {
              console.log(`      No cash asset found for user ${asset.user_id.slice(0, 8)}..., skipping`);
              continue;
            }

            // Calculate tax using user's settings (in USD)
            const taxRate = taxSettings.us_dividend_withholding_rate;
            const taxWithheldUsd = grossAmountUsd * taxRate;
            const netAmountUsd = grossAmountUsd - taxWithheldUsd;

            // Convert to cash asset's currency if different from USD
            const targetCurrency = primaryCashAsset.currency;
            let finalAmount = netAmountUsd;
            let finalTaxWithheld = taxWithheldUsd;
            let flowCurrency = 'USD';

            if (targetCurrency.toUpperCase() !== 'USD') {
              const rateMap = await getExchangeRates(['USD', targetCurrency]);
              const conversion = convertAmount(netAmountUsd, 'USD', targetCurrency, rateMap);
              const taxConversion = convertAmount(taxWithheldUsd, 'USD', targetCurrency, rateMap);

              if (conversion && taxConversion) {
                finalAmount = Math.round(conversion.converted * 100) / 100;
                finalTaxWithheld = Math.round(taxConversion.converted * 100) / 100;
                flowCurrency = targetCurrency;
                console.log(`      Converting: $${netAmountUsd.toFixed(2)} USD → ${finalAmount.toFixed(2)} ${targetCurrency} (rate: ${conversion.rate.toFixed(4)})`);
              }
            }

            // Create dividend income transaction (amount is NET, in cash asset's currency)
            await this.createDividendFlow({
              userId: asset.user_id,
              belongId: asset.belong_id,
              fromAssetId: asset.id,
              toAssetId: primaryCashAsset.id,
              toAssetBalance: primaryCashAsset.balance,
              amount: finalAmount,
              currency: flowCurrency,
              date: dividendDate,
              stockName: asset.name,
              ticker: asset.ticker,
              dividendPerShare: dividend.amount,
              shares: asset.balance,
              taxRate: taxRate,
              taxWithheld: finalTaxWithheld,
            });

            dividendsCreated++;
            console.log(`      Created dividend flow: ${asset.name} - gross: $${grossAmountUsd.toFixed(2)}, tax (${(taxRate * 100).toFixed(0)}%): $${taxWithheldUsd.toFixed(2)}, net: ${finalAmount.toFixed(2)} ${flowCurrency}`);
          }
        }
      } catch (error) {
        console.error(`  Error checking ${ticker}:`, error);
      }
    }

    console.log(`\nSummary:`);
    console.log(`  Dividends created: ${dividendsCreated}`);
    console.log(`  Duplicates skipped: ${duplicatesSkipped}`);
  }

  /**
   * Get all US stock assets with balance > 0
   */
  private async getUSStockAssets(): Promise<UserAsset[]> {
    const { data, error } = await this.supabase
      .from('assets')
      .select('id, user_id, belong_id, name, ticker, balance, currency')
      .in('type', ['stock', 'etf'])
      .eq('market', 'US')
      .gt('balance', 0)
      .not('ticker', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch stock assets: ${error.message}`);
    }

    return (data || []) as UserAsset[];
  }

  /**
   * Fetch recent dividends from Yahoo Finance
   * Returns dividends that have already been paid (payment date <= today)
   * Duplicate check happens later to avoid re-creating existing flows
   */
  private async fetchPaidDividends(ticker: string, today: string): Promise<YahooDividend[]> {
    // Look back 30 days to catch any missed dividends
    const todayDate = new Date(today);
    const startDate = new Date(todayDate);
    startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date(todayDate);
    endDate.setDate(endDate.getDate() + 1);

    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?events=div&interval=1d&period1=${period1}&period2=${period2}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Firewise/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as YahooChartResponse;

      if (data.chart.error) {
        throw new Error(data.chart.error.description);
      }

      const events = data.chart.result?.[0]?.events;
      if (!events?.dividends) {
        return [];
      }

      // Return all dividends with payment date <= today
      const paidDividends: YahooDividend[] = [];
      for (const dividend of Object.values(events.dividends)) {
        const dividendDate = new Date(dividend.date * 1000).toISOString().split('T')[0];
        if (dividendDate <= today) {
          paidDividends.push(dividend);
        }
      }

      return paidDividends;
    } catch (error) {
      // Log but don't throw - some tickers may not have dividend data
      console.log(`  ${ticker}: No dividend data available`);
      return [];
    }
  }

  /**
   * Check if a dividend transaction already exists for this asset and date
   */
  private async checkDuplicateDividend(assetId: string, date: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select('id')
      .eq('source_asset_id', assetId)
      .eq('date', date)
      .eq('category', 'dividend')
      .limit(1);

    if (error) {
      console.error('Error checking for duplicate:', error);
      return false;
    }

    return (data?.length || 0) > 0;
  }

  /**
   * Get user's tax settings (or defaults if not set)
   */
  private async getUserTaxSettings(userId: string): Promise<UserTaxSettings> {
    const { data, error } = await this.supabase
      .from('user_tax_settings')
      .select('us_dividend_withholding_rate')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Return default 30% if no settings found
      return { us_dividend_withholding_rate: 0.30 };
    }

    return {
      us_dividend_withholding_rate: data.us_dividend_withholding_rate ?? 0.30,
    };
  }

  /**
   * Get user's primary cash asset (first cash asset)
   */
  private async getPrimaryCashAsset(userId: string): Promise<{ id: string; currency: string; balance: number } | null> {
    const { data, error } = await this.supabase
      .from('assets')
      .select('id, currency, balance')
      .eq('user_id', userId)
      .eq('type', 'cash')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return { id: data.id, currency: data.currency, balance: data.balance };
  }

  /**
   * Create a dividend income transaction
   * Note: amount is NET (after tax). Tax info stored in metadata.
   * Also updates the cash asset balance.
   */
  private async createDividendFlow(params: {
    userId: string;
    belongId: string;
    fromAssetId: string;
    toAssetId: string;
    toAssetBalance: number;
    amount: number; // NET amount (after tax)
    currency: string;
    date: string;
    stockName: string;
    ticker: string;
    dividendPerShare: number;
    shares: number;
    taxRate: number;
    taxWithheld: number;
  }): Promise<void> {
    // Update cash asset balance
    const newBalance = params.toAssetBalance + params.amount;
    const { error: updateError } = await this.supabase
      .from('assets')
      .update({
        balance: newBalance,
        balance_updated_at: new Date().toISOString(),
      })
      .eq('id', params.toAssetId);

    if (updateError) {
      throw new Error(`Failed to update cash balance: ${updateError.message}`);
    }

    // Create transaction record
    const { error } = await this.supabase.from('transactions').insert({
      belong_id: params.belongId,
      type: 'income',
      category: 'dividend',
      amount: params.amount, // NET amount
      currency: params.currency,
      date: params.date,
      asset_id: params.toAssetId,  // Primary: cash account receiving dividend
      source_asset_id: params.fromAssetId,  // Source: stock paying dividend
      description: `Dividend from ${params.stockName} (${params.ticker})`,
      needs_review: true,
      metadata: {
        dividend_per_share: params.dividendPerShare,
        share_count: params.shares,
        ticker: params.ticker,
        payment_date: params.date,
        tax_rate: params.taxRate,
        tax_withheld: params.taxWithheld,
      },
    });

    if (error) {
      throw new Error(`Failed to create dividend transaction: ${error.message}`);
    }
  }
}
