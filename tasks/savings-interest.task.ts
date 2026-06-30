/**
 * Savings Interest Task
 *
 * Checks all savings accounts and auto-credits interest that is due today or overdue.
 * Mirrors the DCA pattern: derive next due date from history, execute if <= today, repeat.
 *
 * Logic per account:
 *   1. Find last credited_at from interest_records (or fall back to start_date / created_at)
 *   2. Compute next due date via computeNextPayoutDate
 *   3. While next due date <= today:
 *      a. Idempotency check — skip if record for that date already exists
 *      b. Compute interest amount based on current balance
 *      c. Insert interest_record
 *      d. Update balance (compound: new balance = old balance + interest)
 *      e. Advance to next due date
 *
 * Usage: npx ts-node tasks/index.ts savings-interest
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const taskEnvPath = path.join(__dirname, '..', '.env.task');
if (fs.existsSync(taskEnvPath)) {
  dotenv.config({ path: taskEnvPath });
} else {
  dotenv.config();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SavingsAccount {
  id: string;
  belong_id: string;
  name: string;
  balance: number;
  interest_rate: number;
  compound_frequency: 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  start_date: string | null;
  created_at: string;
}

// ── Date helpers (mirrors savings.controller.ts) ─────────────────────────────

const DAYS_PER_PERIOD: Record<string, number> = {
  monthly: 30,
  quarterly: 91,
  semi_annual: 182,
  annual: 365,
};

const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  semi_annual: 2,
  annual: 1,
};

function computeNextPayoutDate(fromDate: string, frequency: string): string {
  const days = DAYS_PER_PERIOD[frequency] ?? 30;
  const d = new Date(fromDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function computeInterestAmount(balance: number, interestRate: number, frequency: string): number {
  const periods = PERIODS_PER_YEAR[frequency] ?? 12;
  return Math.round((balance * interestRate / periods) * 100) / 100;
}

// ── Task ─────────────────────────────────────────────────────────────────────

export class SavingsInterestTask {
  private supabase: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    this.supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async run(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[SavingsInterest] Running for date: ${today}`);

    // Fetch all savings accounts
    const { data: accounts, error } = await this.supabase
      .from('savings_accounts')
      .select('id, belong_id, name, balance, interest_rate, compound_frequency, start_date, created_at');

    if (error) {
      console.error('[SavingsInterest] Failed to fetch accounts:', error.message);
      return;
    }

    if (!accounts || accounts.length === 0) {
      console.log('[SavingsInterest] No savings accounts found.');
      return;
    }

    console.log(`[SavingsInterest] Found ${accounts.length} account(s)`);

    let totalCredited = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const account of accounts as SavingsAccount[]) {
      try {
        const credited = await this.processAccount(account, today);
        totalCredited += credited;
        if (credited === 0) totalSkipped++;
      } catch (err) {
        console.error(`[SavingsInterest] Error processing account ${account.id}:`, err);
        totalErrors++;
      }
    }

    console.log('\n========================================');
    console.log('  Savings Interest Summary');
    console.log(`  Periods credited : ${totalCredited}`);
    console.log(`  Accounts skipped : ${totalSkipped}`);
    console.log(`  Errors           : ${totalErrors}`);
    console.log('========================================');
  }

  private async processAccount(account: SavingsAccount, today: string): Promise<number> {
    console.log(`\n  Processing: ${account.name} (${account.id})`);

    // Find the most recent interest_record for this account
    const { data: lastRecord } = await this.supabase
      .from('interest_records')
      .select('credited_at')
      .eq('account_id', account.id)
      .order('credited_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Determine the base date from which to compute next payout
    const baseDate = lastRecord?.credited_at
      ?? account.start_date
      ?? account.created_at.slice(0, 10);

    let nextDate = computeNextPayoutDate(baseDate, account.compound_frequency);
    let periodsCredited = 0;

    // Process all overdue periods up to today
    while (nextDate <= today) {
      // Idempotency: check if record for this date already exists
      const { data: existing } = await this.supabase
        .from('interest_records')
        .select('id')
        .eq('account_id', account.id)
        .eq('credited_at', nextDate)
        .maybeSingle();

      if (existing) {
        console.log(`    [skip] ${nextDate} — record already exists`);
        nextDate = computeNextPayoutDate(nextDate, account.compound_frequency);
        continue;
      }

      // Simple interest: always use the original balance, not compounded
      const amount = computeInterestAmount(account.balance, account.interest_rate, account.compound_frequency);

      // Insert interest record
      const { error: insertError } = await this.supabase
        .from('interest_records')
        .insert({
          account_id: account.id,
          amount,
          credited_at: nextDate,
          notes: 'auto',
        });

      if (insertError) {
        console.error(`    [error] Failed to insert interest record for ${nextDate}:`, insertError.message);
        break;
      }

      console.log(`    [ok] ${nextDate} — credited ${amount}`);
      periodsCredited++;
      nextDate = computeNextPayoutDate(nextDate, account.compound_frequency);
    }

    if (periodsCredited === 0) {
      console.log(`    Next payout: ${nextDate} — nothing due yet`);
    }

    return periodsCredited;
  }
}
