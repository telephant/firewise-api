/**
 * Check Dividends Task
 *
 * Checks for dividend payments for all stock/ETF holdings and automatically
 * creates income transactions for dividends that have been paid.
 *
 * Logic:
 * 1. Get all stock/ETF assets with balance > 0 (all markets)
 * 2. For each asset:
 *    - Determine fromDate = max(last recorded dividend date, asset creation date)
 *    - Fetch all actual paid dividends from fromDate to today (across years)
 *    - For each new dividend:
 *      - Calculate gross amount: shares × dividend_per_share
 *      - Apply tax withholding and currency conversion
 *      - Create income transaction with needs_review=true
 *      - Update cash asset balance
 *
 * Data source: firewise-findata service (yfinance)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as findata from '../src/utils/findata-client';

dotenv.config();

interface Asset {
  id: string;
  user_id: string;
  belong_id: string;
  name: string;
  ticker: string;
  balance: number;
  currency: string;
  created_at: string;
  market: string | null;
}

interface UserAsset extends Asset {
  primary_cash_asset_id: string | null;
}

interface UserTaxSettings {
  us_dividend_withholding_rate: number;
}

interface PaidDividend {
  amount: number;
  date: string; // YYYY-MM-DD format
  currency: string;
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
    console.log(`Found ${stockAssets.length} stock holdings to check`);

    if (stockAssets.length === 0) {
      console.log('No stocks to check for dividends');
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
    let dividendsUpdated = 0;

    // Check each ticker for dividends
    for (const [ticker, assets] of tickerMap) {
      try {
        // Process each asset individually (each may have a different fromDate)
        for (const asset of assets) {
          // Only fetch dividends since asset was purchased
          const assetCreatedDate = asset.created_at.split('T')[0];

          // Fetch all actual paid dividends since purchase date (across years)
          // Existing records will be compared and updated if amounts differ
          const dividends = await this.fetchAllPaidDividends(ticker, today, assetCreatedDate);
          if (dividends.length === 0) continue;

          console.log(`  ${ticker} (${asset.name}): Found ${dividends.length} new dividend(s) since ${assetCreatedDate}`);

          // Fetch tax settings once per asset
          const taxSettings = await this.getUserTaxSettings(asset.user_id);
          // SGX dividends are not subject to withholding tax
          const taxRate = asset.market?.toUpperCase() === 'SGX'
            ? 0
            : taxSettings.us_dividend_withholding_rate;

          // Track cash balances per currency to avoid re-fetching
          const cashBalanceCache = new Map<string, { id: string; currency: string; balance: number }>();

          for (const dividend of dividends) {
            const dividendDate = dividend.date;
            const dividendCurrency = dividend.currency.toUpperCase();

            // Get cash asset matching dividend currency (with cache)
            if (!cashBalanceCache.has(dividendCurrency)) {
              const cashAsset = await this.getPrimaryCashAsset(asset.user_id, dividendCurrency);
              if (cashAsset) cashBalanceCache.set(dividendCurrency, cashAsset);
            }
            const primaryCashAsset = cashBalanceCache.get(dividendCurrency);

            if (!primaryCashAsset) {
              console.log(`    No cash asset found for currency ${dividendCurrency}, user ${asset.user_id.slice(0, 8)}..., skipping`);
              continue;
            }

            // Calculate gross, tax, net — keep in dividend's currency, no conversion
            const grossAmount = asset.balance * dividend.amount;
            const taxWithheld = grossAmount * taxRate;
            const finalAmount = Math.round((grossAmount - taxWithheld) * 100) / 100;
            const finalTaxWithheld = Math.round(taxWithheld * 100) / 100;

            console.log(`    Payment date: ${dividendDate}, Amount: ${dividend.amount.toFixed(4)} ${dividendCurrency}/share, gross: ${grossAmount.toFixed(2)}, tax (${(taxRate * 100).toFixed(0)}%): ${finalTaxWithheld.toFixed(2)}, net: ${finalAmount.toFixed(2)} ${dividendCurrency}`);

            // Check if a dividend transaction already exists for this asset + date
            const existing = await this.findExistingDividend(asset.id, dividendDate);

            if (existing) {
              const diff = Math.abs(existing.amount - finalAmount);
              if (diff < 0.001) {
                console.log(`    Skipping (unchanged): ${asset.name} ${dividendDate}`);
                continue;
              }
              // Amount changed — update transaction and adjust cash balance
              const balanceDiff = finalAmount - existing.amount;
              await this.updateDividendFlow(existing.id, {
                amount: finalAmount,
                currency: dividendCurrency,
                dividendPerShare: dividend.amount,
                shares: asset.balance,
                taxRate,
                taxWithheld: finalTaxWithheld,
              });
              await this.adjustCashBalance(primaryCashAsset.id, primaryCashAsset.balance, balanceDiff);
              primaryCashAsset.balance += balanceDiff;
              console.log(`    Updated: ${asset.name} ${dividendDate}, amount ${existing.amount.toFixed(2)} → ${finalAmount.toFixed(2)} ${dividendCurrency}`);
              dividendsUpdated++;
            } else {
              await this.createDividendFlow({
                userId: asset.user_id,
                belongId: asset.belong_id,
                fromAssetId: asset.id,
                toAssetId: primaryCashAsset.id,
                toAssetBalance: primaryCashAsset.balance,
                amount: finalAmount,
                currency: dividendCurrency,
                date: dividendDate,
                stockName: asset.name,
                ticker: asset.ticker,
                dividendPerShare: dividend.amount,
                shares: asset.balance,
                taxRate,
                taxWithheld: finalTaxWithheld,
              });
              primaryCashAsset.balance += finalAmount;
              dividendsCreated++;
            }
          }
        }
      } catch (error) {
        console.error(`  Error checking ${ticker}:`, error);
      }
    }

    console.log(`\nSummary:`);
    console.log(`  Dividends created: ${dividendsCreated}`);
    console.log(`  Dividends updated: ${dividendsUpdated}`);
  }

  /**
   * Get all stock/ETF assets with balance > 0 (all markets)
   */
  private async getUSStockAssets(): Promise<UserAsset[]> {
    const { data, error } = await this.supabase
      .from('assets')
      .select('id, user_id, belong_id, name, ticker, balance, currency, created_at, market')
      .in('type', ['stock', 'etf'])
      .gt('balance', 0)
      .not('ticker', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch stock assets: ${error.message}`);
    }

    return (data || []) as UserAsset[];
  }

  /**
   * Fetch all actual (non-forecasted) paid dividends from startDate up to today.
   * Queries all years between startDate and today to avoid missing any payments.
   */
  private async fetchAllPaidDividends(ticker: string, today: string, fromDate?: string): Promise<PaidDividend[]> {
    try {
      const currentYear = new Date().getFullYear();
      const startYear = fromDate ? new Date(fromDate).getFullYear() : currentYear;

      // Collect dividends across all relevant years
      const paidDividends: PaidDividend[] = [];
      for (let year = startYear; year <= currentYear; year++) {
        const dividendData = await findata.fetchDividends(ticker, year);
        if (!dividendData || !dividendData.has_dividends) continue;

        for (const div of dividendData.dividends) {
          if (div.is_forecasted) continue;
          if (div.date > today) continue;
          if (fromDate && div.date <= fromDate) continue; // skip before asset purchase date

          paidDividends.push({
            amount: div.amount,
            date: div.date,
            currency: dividendData.currency,
          });
        }
      }

      // Sort by date ascending so they're processed in order
      paidDividends.sort((a, b) => a.date.localeCompare(b.date));
      return paidDividends;
    } catch (error) {
      console.log(`  ${ticker}: No dividend data available`);
      return [];
    }
  }

  /**
   * Find an existing dividend transaction for an asset on a specific date
   */
  private async findExistingDividend(assetId: string, date: string): Promise<{ id: string; amount: number } | null> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select('id, amount')
      .eq('source_asset_id', assetId)
      .eq('date', date)
      .eq('category', 'dividend')
      .limit(1)
      .single();

    if (error || !data) return null;
    return { id: data.id, amount: data.amount };
  }

  /**
   * Update an existing dividend transaction with new amounts
   */
  private async updateDividendFlow(transactionId: string, params: {
    amount: number;
    currency: string;
    dividendPerShare: number;
    shares: number;
    taxRate: number;
    taxWithheld: number;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('transactions')
      .update({
        amount: params.amount,
        currency: params.currency,
        needs_review: true,
        metadata: {
          dividend_per_share: params.dividendPerShare,
          share_count: params.shares,
          tax_rate: params.taxRate,
          tax_withheld: params.taxWithheld,
        },
      })
      .eq('id', transactionId);

    if (error) {
      throw new Error(`Failed to update dividend transaction: ${error.message}`);
    }
  }

  /**
   * Adjust cash asset balance by a delta amount
   */
  private async adjustCashBalance(assetId: string, currentBalance: number, delta: number): Promise<void> {
    const { error } = await this.supabase
      .from('assets')
      .update({
        balance: currentBalance + delta,
        balance_updated_at: new Date().toISOString(),
      })
      .eq('id', assetId);

    if (error) {
      throw new Error(`Failed to adjust cash balance: ${error.message}`);
    }
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
   * Get the cash asset matching the given currency.
   * Falls back to the first cash asset if no match found.
   */
  private async getPrimaryCashAsset(userId: string, preferredCurrency?: string): Promise<{ id: string; currency: string; balance: number } | null> {
    const { data, error } = await this.supabase
      .from('assets')
      .select('id, currency, balance')
      .eq('user_id', userId)
      .eq('type', 'cash')
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) return null;

    if (preferredCurrency) {
      const match = data.find(a => a.currency.toUpperCase() === preferredCurrency.toUpperCase());
      if (match) return { id: match.id, currency: match.currency, balance: match.balance };
    }

    // Fallback to first cash asset
    return { id: data[0].id, currency: data[0].currency, balance: data[0].balance };
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
