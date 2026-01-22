/**
 * Check Dividends Task
 *
 * Checks for dividend payment dates for US stocks held by users and
 * automatically creates income flows for dividends that are paid today.
 *
 * Logic:
 * 1. Get all users with US stock holdings (type='stock', market='US')
 * 2. For each stock, fetch dividend data from Yahoo Finance API
 * 3. Check if today is a payment date for any dividend
 * 4. For each matching dividend:
 *    - Check for duplicates (same from_asset_id + date + category='dividend')
 *    - Calculate gross amount: shares × dividend_per_share
 *    - Create income flow with needs_review=true
 *
 * API: Yahoo Finance (no API key required)
 * https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?events=div
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

interface Asset {
  id: string;
  user_id: string;
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

            // Calculate gross dividend amount
            const grossAmount = asset.balance * dividend.amount;

            // Get user's tax settings and primary cash asset in parallel
            const [taxSettings, primaryCashAssetId] = await Promise.all([
              this.getUserTaxSettings(asset.user_id),
              this.getPrimaryCashAsset(asset.user_id),
            ]);

            if (!primaryCashAssetId) {
              console.log(`      No cash asset found for user ${asset.user_id.slice(0, 8)}..., skipping`);
              continue;
            }

            // Calculate tax using user's settings
            const taxRate = taxSettings.us_dividend_withholding_rate;
            const taxWithheld = grossAmount * taxRate;
            const netAmount = grossAmount - taxWithheld;

            // Create dividend income flow (amount is GROSS, tax info in metadata)
            await this.createDividendFlow({
              userId: asset.user_id,
              fromAssetId: asset.id,
              toAssetId: primaryCashAssetId,
              amount: netAmount, // Store Net amount
              currency: 'USD',
              date: dividendDate,
              stockName: asset.name,
              ticker: asset.ticker,
              dividendPerShare: dividend.amount,
              shares: asset.balance,
              taxRate: taxRate,
              taxWithheld: taxWithheld,
            });

            dividendsCreated++;
            console.log(`      Created dividend flow: ${asset.name} - gross: $${grossAmount.toFixed(2)}, tax (${(taxRate * 100).toFixed(0)}%): $${taxWithheld.toFixed(2)}, net: $${netAmount.toFixed(2)}`);
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
      .select('id, user_id, name, ticker, balance, currency')
      .eq('type', 'stock')
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
   * Check if a dividend flow already exists for this asset and date
   */
  private async checkDuplicateDividend(assetId: string, date: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('flows')
      .select('id')
      .eq('from_asset_id', assetId)
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
   * Get user's primary cash asset (first USD cash asset)
   */
  private async getPrimaryCashAsset(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('assets')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'cash')
      .eq('currency', 'USD')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.id;
  }

  /**
   * Create a dividend income flow
   * Note: amount is NET (after tax). Tax info stored in metadata.
   */
  private async createDividendFlow(params: {
    userId: string;
    fromAssetId: string;
    toAssetId: string;
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
    const { error } = await this.supabase.from('flows').insert({
      user_id: params.userId,
      type: 'income',
      amount: params.amount, // NET amount
      currency: params.currency,
      from_asset_id: params.fromAssetId,
      to_asset_id: params.toAssetId,
      category: 'dividend',
      date: params.date,
      description: `Dividend from ${params.stockName} (${params.ticker})`,
      needs_review: true,
      metadata: {
        dividend_per_share: params.dividendPerShare,
        share_count: params.shares, // Use share_count instead of shares to avoid triggering balance recalculation
        ticker: params.ticker,
        payment_date: params.date,
        tax_rate: params.taxRate,
        tax_withheld: params.taxWithheld,
      },
    });

    if (error) {
      throw new Error(`Failed to create dividend flow: ${error.message}`);
    }
  }
}
