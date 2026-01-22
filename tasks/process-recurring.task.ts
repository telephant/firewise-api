/**
 * Process Recurring Task
 *
 * Processes all due recurring schedules and creates flows automatically.
 * This task should be run daily via cron job.
 *
 * Logic:
 * 1. Find all active schedules where next_run_date <= today
 * 2. For each schedule:
 *    - Create a flow from the flow_template
 *    - Adjust asset balances based on flow type
 *    - Update schedule's next_run_date and last_run_date
 *
 * Usage: npx ts-node tasks/index.ts process-recurring
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

type FlowType = 'income' | 'expense' | 'transfer' | 'other';
type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

interface FlowTemplate {
  type: FlowType;
  amount: number;
  currency: string;
  from_asset_id: string | null;
  to_asset_id: string | null;
  debt_id: string | null;
  category: string | null;
  description: string | null;
  flow_expense_category_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface RecurringSchedule {
  id: string;
  user_id: string;
  source_flow_id: string | null;
  frequency: ScheduleFrequency;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  flow_template: FlowTemplate;
}

interface ProcessResult {
  processed: number;
  created_flows: string[];
  errors: { schedule_id: string; error: string }[];
}

export class ProcessRecurringTask {
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
    console.log('Processing recurring schedules...');

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
      created_flows: [],
      errors: [],
    };

    // Process each due schedule
    for (const schedule of dueSchedules as RecurringSchedule[]) {
      try {
        console.log(`\nProcessing schedule ${schedule.id.slice(0, 8)}...`);
        console.log(`  Frequency: ${schedule.frequency}`);
        console.log(`  Next run date: ${schedule.next_run_date}`);

        const template = schedule.flow_template;
        console.log(`  Flow type: ${template.type}, Amount: ${template.amount} ${template.currency}`);

        // Create the flow
        const { data: newFlow, error: flowError } = await this.supabase
          .from('flows')
          .insert({
            user_id: schedule.user_id,
            type: template.type,
            amount: template.amount,
            currency: template.currency,
            from_asset_id: template.from_asset_id,
            to_asset_id: template.to_asset_id,
            debt_id: template.debt_id,
            category: template.category,
            date: schedule.next_run_date,
            description: template.description,
            recurring_frequency: null, // Generated flows are not recurring themselves
            flow_expense_category_id: template.flow_expense_category_id,
            schedule_id: schedule.id,
            metadata: template.metadata,
            needs_review: false,
          })
          .select()
          .single();

        if (flowError || !newFlow) {
          result.errors.push({
            schedule_id: schedule.id,
            error: flowError?.message || 'Failed to create flow',
          });
          console.log(`  ✗ Failed to create flow: ${flowError?.message}`);
          continue;
        }

        result.created_flows.push(newFlow.id);
        console.log(`  ✓ Created flow ${newFlow.id.slice(0, 8)}...`);

        // Adjust asset balances based on flow type
        await this.adjustAssetBalances(template, schedule.next_run_date);

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
    console.log(`  Flows created: ${result.created_flows.length}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of result.errors) {
        console.log(`  - ${error.schedule_id.slice(0, 8)}...: ${error.error}`);
      }
    }
  }

  /**
   * Adjust asset balances based on flow template
   */
  private async adjustAssetBalances(template: FlowTemplate, _date: string): Promise<void> {
    const amount = template.amount;

    if (template.type === 'income' && template.to_asset_id) {
      // Income: add to to_asset
      await this.updateAssetBalance(template.to_asset_id, amount);
    } else if (template.type === 'expense' && template.from_asset_id) {
      // Expense: subtract from from_asset
      await this.updateAssetBalance(template.from_asset_id, -amount);
    } else if (template.type === 'transfer') {
      // Transfer: subtract from from_asset, add to to_asset
      if (template.from_asset_id) {
        await this.updateAssetBalance(template.from_asset_id, -amount);
      }
      if (template.to_asset_id) {
        await this.updateAssetBalance(template.to_asset_id, amount);
      }
    }

    // Handle debt payments
    if (template.debt_id && template.category === 'pay_debt') {
      await this.updateDebtBalance(template.debt_id, -amount);
    }
  }

  /**
   * Update asset balance by delta amount
   */
  private async updateAssetBalance(assetId: string, delta: number): Promise<void> {
    // Get current balance
    const { data: asset, error: fetchError } = await this.supabase
      .from('assets')
      .select('balance')
      .eq('id', assetId)
      .single();

    if (fetchError || !asset) {
      console.log(`    ⚠ Asset ${assetId.slice(0, 8)}... not found, skipping balance update`);
      return;
    }

    const newBalance = (asset.balance || 0) + delta;

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
      const sign = delta >= 0 ? '+' : '';
      console.log(`    Asset balance updated: ${sign}${delta} (new: ${newBalance})`);
    }
  }

  /**
   * Update debt balance by delta amount
   */
  private async updateDebtBalance(debtId: string, delta: number): Promise<void> {
    const { data: debt, error: fetchError } = await this.supabase
      .from('debts')
      .select('current_balance')
      .eq('id', debtId)
      .single();

    if (fetchError || !debt) {
      console.log(`    ⚠ Debt ${debtId.slice(0, 8)}... not found, skipping balance update`);
      return;
    }

    const newBalance = Math.max(0, (debt.current_balance || 0) + delta);

    const updates: Record<string, unknown> = {
      current_balance: newBalance,
      balance_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Auto-update status if paid off
    if (newBalance <= 0) {
      updates.status = 'paid_off';
      updates.paid_off_date = new Date().toISOString().split('T')[0];
      console.log(`    Debt paid off!`);
    }

    const { error: updateError } = await this.supabase
      .from('debts')
      .update(updates)
      .eq('id', debtId);

    if (updateError) {
      console.log(`    ⚠ Failed to update debt balance: ${updateError.message}`);
    } else {
      const sign = delta >= 0 ? '+' : '';
      console.log(`    Debt balance updated: ${sign}${delta} (new: ${newBalance})`);
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
