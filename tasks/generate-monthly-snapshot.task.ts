/**
 * Generate Monthly Snapshot Task
 *
 * Creates/updates monthly financial snapshots for all users.
 * Captures: assets, debts, income, expenses at end of month.
 *
 * Usage: npx ts-node tasks/index.ts generate-monthly-snapshot
 * Options:
 *   --month=YYYY-MM  Generate snapshot for specific month (default: previous month)
 *
 * Run this task on the 1st of each month to capture previous month's data.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fetchHistoricalPrices } from '../src/utils/stock-price';

dotenv.config();

interface Asset {
  id: string;
  name: string;
  type: string;
  ticker: string | null;
  balance: number;
  currency: string;
}

interface Debt {
  id: string;
  name: string;
  debt_type: string;
  current_balance: number;
  currency: string;
}

interface Transaction {
  id: string;
  type: string;
  category: string;
  amount: number;
  currency: string;
}

interface SnapshotResult {
  belong_id: string;
  year: number;
  month: number;
  success: boolean;
  error?: string;
}

export class GenerateMonthlySnapshotTask {
  private supabase: SupabaseClient;
  private exchangeRates: Map<string, number> = new Map();
  private targetYear: number;
  private targetMonth: number;

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

    // Parse --month=YYYY-MM argument or use previous month
    const monthArg = process.argv.find((arg) => arg.startsWith('--month='));
    if (monthArg) {
      const [yearStr, monthStr] = monthArg.replace('--month=', '').split('-');
      this.targetYear = parseInt(yearStr, 10);
      this.targetMonth = parseInt(monthStr, 10);
    } else {
      // Default to previous month
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      this.targetYear = prevMonth.getFullYear();
      this.targetMonth = prevMonth.getMonth() + 1; // 1-12
    }
  }

  /**
   * Load exchange rates from database
   */
  private async loadExchangeRates(): Promise<void> {
    const { data, error } = await this.supabase
      .from('currency_exchange')
      .select('code, rate');

    if (error) {
      console.log('Warning: Failed to load exchange rates:', error.message);
      return;
    }

    this.exchangeRates = new Map();
    (data || []).forEach((rate: { code: string; rate: number }) => {
      this.exchangeRates.set(rate.code.toLowerCase(), rate.rate);
    });
    console.log(`Loaded ${this.exchangeRates.size} exchange rates`);
  }

  /**
   * Convert amount to USD
   * Exchange rates are stored as: 1 USD = X foreign currency
   * So to convert foreign -> USD: amount / rate
   */
  private toUSD(amount: number, fromCurrency: string): number {
    const code = fromCurrency.toLowerCase();
    if (code === 'usd') return amount;

    const rate = this.exchangeRates.get(code);
    if (!rate) {
      console.log(`    Warning: No rate for ${fromCurrency}, using 1:1`);
      return amount;
    }
    return amount / rate;
  }

  /**
   * Get all unique belong_ids that have data
   */
  private async getAllBelongIds(): Promise<string[]> {
    // Get belong_ids from assets table (most comprehensive)
    const { data: assets } = await this.supabase
      .from('assets')
      .select('belong_id')
      .not('belong_id', 'is', null);

    const belongIds = new Set<string>();
    (assets || []).forEach((a) => belongIds.add(a.belong_id));

    return Array.from(belongIds);
  }

  /**
   * Generate snapshot for a specific belong_id
   */
  private async generateSnapshot(belongId: string): Promise<SnapshotResult> {
    const result: SnapshotResult = {
      belong_id: belongId,
      year: this.targetYear,
      month: this.targetMonth,
      success: false,
    };

    try {
      // Calculate date range for the month
      const startDate = `${this.targetYear}-${String(this.targetMonth).padStart(2, '0')}-01`;
      const lastDay = new Date(this.targetYear, this.targetMonth, 0).getDate();
      const endDate = `${this.targetYear}-${String(this.targetMonth).padStart(2, '0')}-${lastDay}`;

      // Fetch assets that existed at end of target month
      // IMPORTANT: Filter by created_at to exclude assets created after the target month
      const { data: assets, error: assetsError } = await this.supabase
        .from('assets')
        .select('id, name, type, ticker, balance, currency')
        .eq('belong_id', belongId)
        .lte('created_at', `${endDate}T23:59:59Z`);

      if (assetsError) throw new Error(`Assets: ${assetsError.message}`);
      console.log(`    Assets (created <= ${endDate}): ${(assets || []).length}`);

      // Fetch debts that existed at end of target month
      // IMPORTANT: Filter by created_at to exclude debts created after the target month
      const { data: debts, error: debtsError } = await this.supabase
        .from('debts')
        .select('id, name, debt_type, current_balance, currency')
        .eq('belong_id', belongId)
        .lte('created_at', `${endDate}T23:59:59Z`);

      if (debtsError) throw new Error(`Debts: ${debtsError.message}`);
      console.log(`    Debts (created <= ${endDate}): ${(debts || []).length}`);

      // Calculate date for "after target month" transactions
      const afterMonthStart = new Date(this.targetYear, this.targetMonth, 1).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];

      // Fetch transactions AFTER target month to reverse them
      const { data: afterMonthTxns, error: afterTxnError } = await this.supabase
        .from('transactions')
        .select('id, type, category, amount, currency, asset_id, source_asset_id, debt_id, shares')
        .eq('belong_id', belongId)
        .gte('date', afterMonthStart)
        .lte('date', today);

      if (afterTxnError) throw new Error(`AfterMonthTxns: ${afterTxnError.message}`);

      // Build adjustment maps for assets and debts
      // For stocks/ETFs: adjustments are in shares (balance is share count)
      // For cash/deposit: adjustments are in the asset's native currency
      const assetShareAdjustments: Record<string, number> = {}; // For stocks/ETFs (shares)
      const assetAmountAdjustments: Record<string, { amount: number; currency: string }[]> = {}; // For cash/deposits (amounts with currency)
      const debtAdjustments: Record<string, { amount: number; currency: string }[]> = {};

      (afterMonthTxns || []).forEach((txn: {
        type: string;
        category: string;
        amount: number;
        currency: string;
        asset_id: string | null;
        source_asset_id: string | null;
        debt_id: string | null;
        shares: number | null;
      }) => {
        const amount = txn.amount || 0;
        const shares = txn.shares || 0;
        const currency = txn.currency || 'USD';

        // Buy stock/ETF: asset_id gains shares, source_asset_id (cash) loses amount
        // To reverse: SUBTRACT shares from asset_id, ADD amount to source_asset_id
        if ((txn.category === 'buy' || txn.category === 'invest') && txn.asset_id) {
          assetShareAdjustments[txn.asset_id] = (assetShareAdjustments[txn.asset_id] || 0) - shares;
          if (txn.source_asset_id) {
            if (!assetAmountAdjustments[txn.source_asset_id]) assetAmountAdjustments[txn.source_asset_id] = [];
            assetAmountAdjustments[txn.source_asset_id].push({ amount: amount, currency });
          }
        }

        // Sell stock/ETF: asset_id loses shares, source_asset_id (cash) gains amount
        // To reverse: ADD shares to asset_id, SUBTRACT amount from source_asset_id
        if (txn.category === 'sell' && txn.asset_id) {
          assetShareAdjustments[txn.asset_id] = (assetShareAdjustments[txn.asset_id] || 0) + shares;
          if (txn.source_asset_id) {
            if (!assetAmountAdjustments[txn.source_asset_id]) assetAmountAdjustments[txn.source_asset_id] = [];
            assetAmountAdjustments[txn.source_asset_id].push({ amount: -amount, currency });
          }
        }

        // Debt payment: debt balance decreases, cash decreases
        // To reverse: ADD amount to debt, ADD amount to source_asset_id
        if (txn.type === 'debt_payment' && txn.debt_id) {
          if (!debtAdjustments[txn.debt_id]) debtAdjustments[txn.debt_id] = [];
          debtAdjustments[txn.debt_id].push({ amount: amount, currency });
          if (txn.source_asset_id) {
            if (!assetAmountAdjustments[txn.source_asset_id]) assetAmountAdjustments[txn.source_asset_id] = [];
            assetAmountAdjustments[txn.source_asset_id].push({ amount: amount, currency });
          }
        }

        // Income to asset: asset gains amount
        // To reverse: SUBTRACT amount from asset_id
        if (txn.type === 'income' && txn.asset_id && txn.category !== 'dividend') {
          if (!assetAmountAdjustments[txn.asset_id]) assetAmountAdjustments[txn.asset_id] = [];
          assetAmountAdjustments[txn.asset_id].push({ amount: -amount, currency });
        }

        // Expense from asset: asset loses amount
        // To reverse: ADD amount to asset_id
        if (txn.type === 'expense' && (txn.asset_id || txn.source_asset_id)) {
          const assetId = txn.source_asset_id || txn.asset_id!;
          if (!assetAmountAdjustments[assetId]) assetAmountAdjustments[assetId] = [];
          assetAmountAdjustments[assetId].push({ amount: amount, currency });
        }
      });

      console.log(`    Adjustments: ${Object.keys(assetShareAdjustments).length} share, ${Object.keys(assetAmountAdjustments).length} amount, ${Object.keys(debtAdjustments).length} debts`);

      // Fetch historical stock/ETF prices for end of target month
      const stockAssets = (assets || []).filter((a: Asset) =>
        (a.type === 'stock' || a.type === 'etf') && a.ticker
      );
      const tickers = stockAssets.map((a: Asset) => a.ticker!);

      let historicalPrices: Map<string, { price: number; currency: string }> = new Map();
      if (tickers.length > 0) {
        console.log(`    Fetching historical prices for ${tickers.length} tickers...`);
        historicalPrices = await fetchHistoricalPrices(tickers, this.targetYear, this.targetMonth);
        console.log(`    Got prices for ${historicalPrices.size} tickers`);
      }

      // Fetch income transactions for the month
      const { data: incomeTransactions, error: incomeError } = await this.supabase
        .from('transactions')
        .select('id, type, category, amount, currency')
        .eq('belong_id', belongId)
        .eq('type', 'income')
        .gte('date', startDate)
        .lte('date', endDate);

      if (incomeError) throw new Error(`Income: ${incomeError.message}`);

      // Fetch expense transactions for the month
      const { data: expenseTransactions, error: expenseError } = await this.supabase
        .from('transactions')
        .select('id, type, category, amount, currency')
        .eq('belong_id', belongId)
        .eq('type', 'expense')
        .neq('category', 'transfer')
        .gte('date', startDate)
        .lte('date', endDate);

      if (expenseError) throw new Error(`Expenses: ${expenseError.message}`);

      // Fetch debt payments for the month
      const { data: debtPayments, error: debtPayError } = await this.supabase
        .from('transactions')
        .select('id, type, category, amount, currency')
        .eq('belong_id', belongId)
        .eq('type', 'debt_payment')
        .gte('date', startDate)
        .lte('date', endDate);

      if (debtPayError) throw new Error(`DebtPayments: ${debtPayError.message}`);

      // Calculate asset totals (convert each to USD based on its currency)
      // Apply historical adjustments to get the balance at end of target month
      let totalAssets = 0;
      const assetsByType: Record<string, number> = {};
      const assetsSnapshot = (assets || []).map((a: Asset) => {
        let historicalBalance = a.balance;
        const assetCurrency = a.currency || 'USD';

        // For stocks/ETFs: apply share adjustments directly (balance = shares)
        if ((a.type === 'stock' || a.type === 'etf') && assetShareAdjustments[a.id]) {
          historicalBalance += assetShareAdjustments[a.id];
        }

        // For cash/deposit/other: apply amount adjustments (convert to asset's currency)
        if (assetAmountAdjustments[a.id]) {
          assetAmountAdjustments[a.id].forEach((adj) => {
            // Convert adjustment amount to asset's currency
            if (adj.currency.toLowerCase() === assetCurrency.toLowerCase()) {
              historicalBalance += adj.amount;
            } else {
              // Convert via USD
              const adjUsd = this.toUSD(adj.amount, adj.currency);
              const usdRate = this.exchangeRates.get(assetCurrency.toLowerCase()) || 1;
              historicalBalance += adjUsd * usdRate;
            }
          });
        }

        let balanceUsd: number;

        // For stocks/ETFs: balance is shares, need to multiply by historical price
        if ((a.type === 'stock' || a.type === 'etf') && a.ticker) {
          const priceData = historicalPrices.get(a.ticker);
          if (priceData) {
            // Convert price to USD if needed, then multiply by shares
            const priceUsd = this.toUSD(priceData.price, priceData.currency);
            balanceUsd = historicalBalance * priceUsd;
          } else {
            // Fallback: no price data, log warning and use 0
            console.log(`    Warning: No price for ${a.ticker}, using $0`);
            balanceUsd = 0;
          }
        } else {
          // For non-stock assets: balance is monetary amount, convert to USD
          balanceUsd = this.toUSD(historicalBalance, assetCurrency);
        }

        totalAssets += balanceUsd;
        assetsByType[a.type] = (assetsByType[a.type] || 0) + balanceUsd;
        return {
          id: a.id,
          name: a.name,
          type: a.type,
          ticker: a.ticker,
          balance: historicalBalance,
          currency: assetCurrency,
          balance_usd: Math.round(balanceUsd * 100) / 100,
        };
      });

      // Calculate debt totals (convert each to USD based on its currency)
      // Apply historical adjustments to get the balance at end of target month
      let totalDebts = 0;
      const debtsSnapshot = (debts || []).map((d: Debt) => {
        let historicalBalance = d.current_balance;
        const debtCurrency = d.currency || 'USD';

        // Apply amount adjustments (convert to debt's currency)
        if (debtAdjustments[d.id]) {
          debtAdjustments[d.id].forEach((adj) => {
            if (adj.currency.toLowerCase() === debtCurrency.toLowerCase()) {
              historicalBalance += adj.amount;
            } else {
              // Convert via USD
              const adjUsd = this.toUSD(adj.amount, adj.currency);
              const usdRate = this.exchangeRates.get(debtCurrency.toLowerCase()) || 1;
              historicalBalance += adjUsd * usdRate;
            }
          });
        }

        const balanceUsd = this.toUSD(historicalBalance, debtCurrency);
        totalDebts += balanceUsd;
        return {
          id: d.id,
          name: d.name,
          debt_type: d.debt_type,
          current_balance: historicalBalance,
          currency: d.currency || 'USD',
          balance_usd: Math.round(balanceUsd * 100) / 100,
        };
      });

      // Calculate income totals (convert each transaction to USD based on its currency)
      const PASSIVE_CATEGORIES = ['dividend', 'interest', 'rental', 'royalty', 'passive_other'];
      let totalIncome = 0;
      let activeIncome = 0;
      let passiveIncome = 0;
      const incomeByCategory: Record<string, number> = {};

      console.log(`    Income transactions: ${(incomeTransactions || []).length}`);
      (incomeTransactions || []).forEach((t: Transaction) => {
        const amountUsd = this.toUSD(t.amount, t.currency || 'USD');
        console.log(`      - ${t.category}: ${t.amount} ${t.currency || 'USD'} -> $${amountUsd.toFixed(2)}`);
        totalIncome += amountUsd;

        if (PASSIVE_CATEGORIES.includes(t.category)) {
          passiveIncome += amountUsd;
        } else {
          activeIncome += amountUsd;
        }

        const cat = t.category || 'other';
        incomeByCategory[cat] = (incomeByCategory[cat] || 0) + amountUsd;
      });

      // Calculate expense totals (convert each transaction to USD based on its currency)
      let totalExpenses = 0;
      const expensesByCategory: Record<string, number> = {};

      (expenseTransactions || []).forEach((t: Transaction) => {
        const amountUsd = this.toUSD(t.amount, t.currency || 'USD');
        totalExpenses += amountUsd;

        const cat = t.category || 'other';
        expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amountUsd;
      });

      // Add debt payments to expenses
      (debtPayments || []).forEach((t: Transaction) => {
        const amountUsd = this.toUSD(t.amount, t.currency || 'USD');
        totalExpenses += amountUsd;
        expensesByCategory['debt_payment'] = (expensesByCategory['debt_payment'] || 0) + amountUsd;
      });

      // Round all totals
      totalAssets = Math.round(totalAssets * 100) / 100;
      totalDebts = Math.round(totalDebts * 100) / 100;
      totalIncome = Math.round(totalIncome * 100) / 100;
      activeIncome = Math.round(activeIncome * 100) / 100;
      passiveIncome = Math.round(passiveIncome * 100) / 100;
      totalExpenses = Math.round(totalExpenses * 100) / 100;

      // Round category breakdowns
      Object.keys(assetsByType).forEach((k) => {
        assetsByType[k] = Math.round(assetsByType[k] * 100) / 100;
      });
      Object.keys(incomeByCategory).forEach((k) => {
        incomeByCategory[k] = Math.round(incomeByCategory[k] * 100) / 100;
      });
      Object.keys(expensesByCategory).forEach((k) => {
        expensesByCategory[k] = Math.round(expensesByCategory[k] * 100) / 100;
      });

      // Calculate 12-month average passive income
      // Get date 12 months ago from end of target month
      const twelveMonthsAgo = new Date(this.targetYear, this.targetMonth - 12, 1);
      const start12m = twelveMonthsAgo.toISOString().split('T')[0];

      const { data: passiveTransactions12m, error: passive12mError } = await this.supabase
        .from('transactions')
        .select('amount, currency')
        .eq('belong_id', belongId)
        .eq('type', 'income')
        .in('category', PASSIVE_CATEGORIES)
        .gte('date', start12m)
        .lte('date', endDate);

      if (passive12mError) {
        console.log(`    Warning: Failed to fetch 12m passive income: ${passive12mError.message}`);
      }

      let totalPassive12m = 0;
      (passiveTransactions12m || []).forEach((t: { amount: number; currency: string }) => {
        totalPassive12m += this.toUSD(t.amount, t.currency || 'USD');
      });
      const avgPassiveIncome12m = Math.round((totalPassive12m / 12) * 100) / 100;
      console.log(`    12m Passive: $${totalPassive12m.toFixed(2)} -> Avg: $${avgPassiveIncome12m.toFixed(2)}/mo`);

      // Upsert snapshot
      const { error: upsertError } = await this.supabase
        .from('monthly_financial_snapshots')
        .upsert(
          {
            belong_id: belongId,
            year: this.targetYear,
            month: this.targetMonth,
            snapshot_date: endDate,
            currency: 'USD',
            total_assets: totalAssets,
            total_debts: totalDebts,
            net_worth: totalAssets - totalDebts,
            total_income: totalIncome,
            active_income: activeIncome,
            passive_income: passiveIncome,
            avg_passive_income_12m: avgPassiveIncome12m,
            total_expenses: totalExpenses,
            assets: assetsSnapshot,
            debts: debtsSnapshot,
            assets_by_type: assetsByType,
            income_by_category: incomeByCategory,
            expenses_by_category: expensesByCategory,
          },
          { onConflict: 'belong_id,year,month' }
        );

      if (upsertError) throw new Error(`Upsert: ${upsertError.message}`);

      result.success = true;
      const netWorth = totalAssets - totalDebts;
      console.log(
        `  ✓ ${belongId.slice(0, 8)}... | NW: $${netWorth.toLocaleString()} | Income: $${totalIncome.toLocaleString()} | Expenses: $${totalExpenses.toLocaleString()}`
      );
    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Unknown error';
      console.log(`  ✗ ${belongId.slice(0, 8)}... | Error: ${result.error}`);
    }

    return result;
  }

  async run(): Promise<void> {
    // Check if target month is current month - skip if so (current month is calculated on the fly)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    if (this.targetYear === currentYear && this.targetMonth === currentMonth) {
      console.log(`Skipping ${this.targetYear}-${String(this.targetMonth).padStart(2, '0')} - current month is calculated on the fly`);
      console.log('Use --month=YYYY-MM to generate for a specific past month');
      return;
    }

    // Check if target month is in the future
    if (this.targetYear > currentYear || (this.targetYear === currentYear && this.targetMonth > currentMonth)) {
      console.log(`Cannot generate snapshot for future month ${this.targetYear}-${String(this.targetMonth).padStart(2, '0')}`);
      return;
    }

    // If no specific month was provided (using default previous month), check if snapshots already exist
    const monthArg = process.argv.find((arg) => arg.startsWith('--month='));
    if (!monthArg) {
      const { data: existingSnapshots } = await this.supabase
        .from('monthly_financial_snapshots')
        .select('id')
        .eq('year', this.targetYear)
        .eq('month', this.targetMonth)
        .limit(1);

      if (existingSnapshots && existingSnapshots.length > 0) {
        console.log(`Snapshot for ${this.targetYear}-${String(this.targetMonth).padStart(2, '0')} already exists, skipping`);
        console.log('Use --month=YYYY-MM to force regenerate for a specific month');
        return;
      }
    }

    console.log(`Generating snapshots for ${this.targetYear}-${String(this.targetMonth).padStart(2, '0')}`);
    console.log('');

    // Load exchange rates
    await this.loadExchangeRates();

    // Get all belong_ids
    const belongIds = await this.getAllBelongIds();
    console.log(`Found ${belongIds.length} users/families to process\n`);

    if (belongIds.length === 0) {
      console.log('No data to process');
      return;
    }

    // Process each belong_id
    const results: SnapshotResult[] = [];
    for (const belongId of belongIds) {
      const result = await this.generateSnapshot(belongId);
      results.push(result);
    }

    // Summary
    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log('\n========================================');
    console.log('Summary:');
    console.log(`  Snapshots created: ${success}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed:');
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(`  - ${r.belong_id.slice(0, 8)}...: ${r.error}`);
        });
    }
  }
}
