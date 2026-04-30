/**
 * Process Recurring Task
 *
 * Processes all due recurring schedules and creates transactions automatically.
 * This task should be run daily via cron job.
 *
 * Logic:
 * 1. Find all active schedules where next_run_date <= today
 * 2. For each schedule:
 *    - Create a transaction from the transaction_template
 *    - Adjust asset balances based on transaction type
 *    - Update schedule's next_run_date and last_run_date
 *
 * Usage: npx ts-node tasks/index.ts process-recurring
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

type TransactionType = 'income' | 'expense' | 'buy' | 'sell' | 'debt_payment' | 'loan';
type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

interface TransactionTemplate {
  type: TransactionType;
  amount: number;
  currency: string;
  from_asset_id: string | null;
  to_asset_id: string | null;
  debt_id: string | null;
  category: string | null;
  description: string | null;
  expense_category_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface RecurringSchedule {
  id: string;
  belong_id: string;
  source_transaction_id: string | null;
  frequency: ScheduleFrequency;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  transaction_template: TransactionTemplate;
}

interface ProcessResult {
  processed: number;
  created_transactions: string[];
  errors: { schedule_id: string; error: string }[];
}

export class ProcessRecurringTask {
  private supabase: SupabaseClient;
  private exchangeRates: Map<string, number> = new Map();

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

  /**
   * Fetch all exchange rates from database
   */
  private async loadExchangeRates(): Promise<void> {
    const { data, error } = await this.supabase
      .from('currency_exchange')
      .select('code, rate');

    if (error) {
      console.log('⚠ Failed to load exchange rates:', error.message);
      return;
    }

    this.exchangeRates = new Map();
    (data || []).forEach((rate: { code: string; rate: number }) => {
      this.exchangeRates.set(rate.code.toLowerCase(), rate.rate);
    });
    console.log(`Loaded ${this.exchangeRates.size} exchange rates`);
  }

  /**
   * Convert amount from one currency to another
   */
  private convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
    const fromCode = fromCurrency.toLowerCase();
    const toCode = toCurrency.toLowerCase();

    if (fromCode === toCode) {
      return amount;
    }

    const fromRate = fromCode === 'usd' ? 1 : this.exchangeRates.get(fromCode);
    const toRate = toCode === 'usd' ? 1 : this.exchangeRates.get(toCode);

    if (fromRate === undefined || toRate === undefined) {
      console.log(`    ⚠ Exchange rate not found for ${fromCurrency} -> ${toCurrency}, using original amount`);
      return amount;
    }

    // Convert to USD first, then to target currency
    const amountInUsd = fromCode === 'usd' ? amount : amount / fromRate;
    return toCode === 'usd' ? amountInUsd : amountInUsd * toRate;
  }

  async run(): Promise<void> {
    console.log('Processing recurring schedules...');

    // Load exchange rates for currency conversion
    await this.loadExchangeRates();

    const today = new Date().toISOString().split('T')[0];
    console.log(`Today: ${today}`);

    // Find all active schedules due to run
    const { data: dueSchedules, error: fetchError } = await this.supabase
      .from('recurring_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);

    if (fetchError) {
      throw new Error(`Failed to fetch due schedules: ${fetchError.message}`);
    }

    console.log(`Found ${dueSchedules?.length || 0} schedules due for processing`);

    if (!dueSchedules || dueSchedules.length === 0) {
      console.log('No schedules to process');
      return;
    }

    const result: ProcessResult = {
      processed: 0,
      created_transactions: [],
      errors: [],
    };

    // Process each due schedule
    for (const schedule of dueSchedules as RecurringSchedule[]) {
      try {
        console.log(`\nProcessing schedule ${schedule.id.slice(0, 8)}...`);
        console.log(`  Frequency: ${schedule.frequency}`);
        console.log(`  Next run date: ${schedule.next_run_date}`);

        const template = schedule.transaction_template;
        console.log(`  Transaction type: ${template.type}, Amount: ${template.amount} ${template.currency}`);

        // Determine asset_id based on transaction type
        // - income: to_asset_id (where money goes)
        // - expense/debt_payment: from_asset_id (where money comes from)
        // - buy: to_asset_id (investment being bought)
        // - sell: from_asset_id (investment being sold)
        let rawAssetId: string | null = null;
        if (template.type === 'income' || template.type === 'buy') {
          rawAssetId = template.to_asset_id;
        } else if (template.type === 'expense' || template.type === 'debt_payment' || template.type === 'sell') {
          rawAssetId = template.from_asset_id;
        } else {
          rawAssetId = template.to_asset_id || template.from_asset_id;
        }

        // Validate asset_id exists to avoid foreign key constraint errors
        let assetId: string | null = null;
        if (rawAssetId) {
          const { data: assetCheck } = await this.supabase
            .from('assets')
            .select('id')
            .eq('id', rawAssetId)
            .single();
          if (assetCheck) {
            assetId = rawAssetId;
          } else {
            console.log(`  ⚠ asset_id ${rawAssetId.slice(0, 8)}... not found, setting to null`);
          }
        }

        // Validate debt_id exists to avoid foreign key constraint errors
        let debtId: string | null = null;
        if (template.debt_id) {
          const { data: debtCheck } = await this.supabase
            .from('debts')
            .select('id')
            .eq('id', template.debt_id)
            .single();
          if (debtCheck) {
            debtId = template.debt_id;
          } else {
            console.log(`  ⚠ debt_id ${template.debt_id.slice(0, 8)}... not found, setting to null`);
          }
        }

        // Extract shares and price_per_share from metadata for buy/sell transactions
        const metadata = template.metadata as Record<string, unknown> | null;
        const shares = metadata?.shares as number | undefined;
        const pricePerShare = shares && shares > 0 && template.amount > 0
          ? template.amount / shares
          : (metadata?.price_per_share as number | undefined);

        // Create the transaction (transactions table uses belong_id, not user_id)
        const { data: newTransaction, error: txError } = await this.supabase
          .from('transactions')
          .insert({
            belong_id: schedule.belong_id,
            type: template.type,
            amount: template.amount,
            currency: template.currency,
            asset_id: assetId,
            source_asset_id: template.type === 'income' ? null : (template.from_asset_id === rawAssetId ? assetId : null),
            debt_id: debtId,
            category: template.category,
            date: schedule.next_run_date,
            description: template.description,
            expense_category_id: template.expense_category_id,
            schedule_id: schedule.id,
            metadata: template.metadata,
            needs_review: false,
            // Include shares for buy/sell transactions
            shares: (template.type === 'buy' || template.type === 'sell') ? shares : null,
            price_per_share: (template.type === 'buy' || template.type === 'sell') ? pricePerShare : null,
          })
          .select()
          .single();

        if (txError || !newTransaction) {
          result.errors.push({
            schedule_id: schedule.id,
            error: txError?.message || 'Failed to create transaction',
          });
          console.log(`  ✗ Failed to create transaction: ${txError?.message}`);
          continue;
        }

        result.created_transactions.push(newTransaction.id);
        console.log(`  ✓ Created transaction ${newTransaction.id.slice(0, 8)}...`);

        // Adjust asset balances based on transaction type
        await this.adjustAssetBalances({ ...template, debt_id: debtId }, schedule.next_run_date);

        // Calculate next run date
        const nextDate = this.calculateNextRunDate(schedule.next_run_date, schedule.frequency);
        console.log(`  Next run date: ${nextDate}`);

        // Update schedule with new next_run_date and last_run_date
        const { error: updateError } = await this.supabase
          .from('recurring_schedules')
          .update({
            next_run_date: nextDate,
            last_run_date: schedule.next_run_date,
            updated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id);

        if (updateError) {
          console.log(`  ⚠ Failed to update schedule: ${updateError.message}`);
        }

        result.processed++;
      } catch (scheduleErr) {
        const errorMessage = scheduleErr instanceof Error ? scheduleErr.message : 'Unknown error';
        result.errors.push({
          schedule_id: schedule.id,
          error: errorMessage,
        });
        console.log(`  ✗ Error processing schedule: ${errorMessage}`);
      }
    }

    // Print summary
    console.log('\n========================================');
    console.log('Summary:');
    console.log(`  Schedules processed: ${result.processed}`);
    console.log(`  Transactions created: ${result.created_transactions.length}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of result.errors) {
        console.log(`  - ${error.schedule_id.slice(0, 8)}...: ${error.error}`);
      }
    }
  }

  /**
   * Adjust asset balances based on transaction template
   */
  private async adjustAssetBalances(template: TransactionTemplate, _date: string): Promise<void> {
    const amount = template.amount;
    const txCurrency = template.currency;
    const metadata = template.metadata as Record<string, unknown> | null;

    if (template.type === 'income' && template.to_asset_id) {
      // Income: add to to_asset
      await this.updateAssetBalance(template.to_asset_id, amount, txCurrency);
    } else if (template.type === 'expense' && template.from_asset_id) {
      // Expense: subtract from from_asset
      await this.updateAssetBalance(template.from_asset_id, -amount, txCurrency);
    } else if (template.type === 'buy') {
      // Buy (invest): subtract from source (cash), add shares/units to investment
      if (template.from_asset_id) {
        await this.updateAssetBalance(template.from_asset_id, -amount, txCurrency);
      }
      // Add shares/units to investment asset
      if (template.to_asset_id) {
        const shares = metadata?.shares as number | undefined;
        if (shares && shares > 0) {
          // For stock/ETF/crypto/metals: add shares/units directly to balance
          await this.addSharesToAsset(template.to_asset_id, shares);
        }
      }
    } else if (template.type === 'sell') {
      // Sell: subtract shares from investment, add cash to destination
      if (template.to_asset_id) {
        await this.updateAssetBalance(template.to_asset_id, amount, txCurrency);
      }
      // Subtract shares from investment asset
      if (template.from_asset_id) {
        const shares = metadata?.shares as number | undefined;
        if (shares && shares > 0) {
          await this.addSharesToAsset(template.from_asset_id, -shares);
        }
      }
    }

    // Handle debt payments
    if (template.debt_id && template.type === 'debt_payment') {
      await this.updateDebtBalance(template.debt_id, -amount, txCurrency);
      if (template.from_asset_id) {
        await this.updateAssetBalance(template.from_asset_id, -amount, txCurrency);
      }
    }
  }

  /**
   * Add shares/units to an asset (for stock/ETF/crypto/metals)
   * This updates balance directly without currency conversion
   */
  private async addSharesToAsset(assetId: string, shares: number): Promise<void> {
    const { data: asset, error: fetchError } = await this.supabase
      .from('assets')
      .select('balance, name, type')
      .eq('id', assetId)
      .single();

    if (fetchError || !asset) {
      console.log(`    ⚠ Asset ${assetId.slice(0, 8)}... not found, skipping shares update`);
      return;
    }

    const newBalance = Math.max(0, (asset.balance || 0) + shares);

    const { error: updateError } = await this.supabase
      .from('assets')
      .update({
        balance: newBalance,
        balance_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', assetId);

    if (updateError) {
      console.log(`    ⚠ Failed to update asset shares: ${updateError.message}`);
    } else {
      const sign = shares >= 0 ? '+' : '';
      const unit = asset.type === 'metals' ? 'units' : 'shares';
      console.log(`    Asset ${unit} updated: ${sign}${shares} (new balance: ${newBalance}) - ${asset.name}`);
    }
  }

  /**
   * Update asset balance by delta amount (with currency conversion)
   */
  private async updateAssetBalance(assetId: string, delta: number, txCurrency: string): Promise<void> {
    // Get current balance and currency
    const { data: asset, error: fetchError } = await this.supabase
      .from('assets')
      .select('balance, currency')
      .eq('id', assetId)
      .single();

    if (fetchError || !asset) {
      console.log(`    ⚠ Asset ${assetId.slice(0, 8)}... not found, skipping balance update`);
      return;
    }

    // Convert delta to asset currency if different
    const assetCurrency = asset.currency || 'USD';
    const convertedDelta = this.convertCurrency(delta, txCurrency, assetCurrency);
    // Prevent negative balance - set to zero if calculation would go negative
    const newBalance = Math.max(0, (asset.balance || 0) + convertedDelta);

    const { error: updateError } = await this.supabase
      .from('assets')
      .update({
        balance: newBalance,
        balance_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', assetId);

    if (updateError) {
      console.log(`    ⚠ Failed to update asset balance: ${updateError.message}`);
    } else {
      const sign = convertedDelta >= 0 ? '+' : '';
      const currencyNote = txCurrency !== assetCurrency ? ` (converted from ${txCurrency})` : '';
      console.log(`    Asset balance updated: ${sign}${convertedDelta.toFixed(2)} ${assetCurrency}${currencyNote} (new: ${newBalance.toFixed(2)})`);
    }
  }

  /**
   * Update debt balance by delta amount (with currency conversion)
   */
  private async updateDebtBalance(debtId: string, delta: number, txCurrency: string): Promise<void> {
    const { data: debt, error: fetchError } = await this.supabase
      .from('debts')
      .select('current_balance, currency')
      .eq('id', debtId)
      .single();

    if (fetchError || !debt) {
      console.log(`    ⚠ Debt ${debtId.slice(0, 8)}... not found, skipping balance update`);
      return;
    }

    // Convert delta to debt currency if different
    const debtCurrency = debt.currency || 'USD';
    const convertedDelta = this.convertCurrency(delta, txCurrency, debtCurrency);
    const newBalance = Math.max(0, (debt.current_balance || 0) + convertedDelta);

    const updates: Record<string, unknown> = {
      current_balance: newBalance,
      balance_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Auto-update status if paid off
    if (newBalance <= 0) {
      updates.status = 'paid_off';
      updates.paid_off_date = new Date().toISOString().split('T')[0];
      console.log(`    🎉 Debt paid off!`);
    }

    const { error: updateError } = await this.supabase
      .from('debts')
      .update(updates)
      .eq('id', debtId);

    if (updateError) {
      console.log(`    ⚠ Failed to update debt balance: ${updateError.message}`);
    } else {
      const sign = convertedDelta >= 0 ? '+' : '';
      const currencyNote = txCurrency !== debtCurrency ? ` (converted from ${txCurrency})` : '';
      console.log(`    Debt balance updated: ${sign}${convertedDelta.toFixed(2)} ${debtCurrency}${currencyNote} (new: ${newBalance.toFixed(2)})`);
    }
  }

  /**
   * Calculate the next run date based on frequency
   */
  private calculateNextRunDate(currentDate: string, frequency: ScheduleFrequency): string {
    const date = new Date(currentDate);

    switch (frequency) {
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'biweekly':
        date.setDate(date.getDate() + 14);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'quarterly':
        date.setMonth(date.getMonth() + 3);
        break;
      case 'yearly':
        date.setFullYear(date.getFullYear() + 1);
        break;
    }

    return date.toISOString().split('T')[0];
  }
}
