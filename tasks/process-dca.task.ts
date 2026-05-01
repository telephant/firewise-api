/**
 * Process DCA Task
 *
 * Generates pending confirmation records for DCA plans that are due today.
 * Fetches suggested prices from findata. Advances next_run_date.
 *
 * Usage: npx ts-node tasks/index.ts process-dca
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as findata from '../src/utils/findata-client';
import type { StockPrice } from '../src/utils/findata-client';

dotenv.config();

interface DcaPlan {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  mode: 'amount' | 'shares';
  amount: number | null;
  shares: number | null;
  next_run_date: string;
}

function advanceDate(date: string, frequency: DcaPlan['frequency']): string {
  const d = new Date(date);
  const originalDay = d.getDate();

  switch (frequency) {
    case 'weekly':   d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
      d.setDate(1);
      d.setMonth(d.getMonth() + months);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, daysInMonth));
      break;
    }
  }
  return d.toISOString().split('T')[0];
}

export class ProcessDcaTask {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  async run(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[ProcessDca] Running for date: ${today}`);

    const { data: duePlans, error } = await this.supabase
      .from('dca_plans')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);

    if (error) {
      console.error('[ProcessDca] Failed to fetch due plans:', error);
      return;
    }

    if (!duePlans || duePlans.length === 0) {
      console.log('[ProcessDca] No plans due today.');
      return;
    }

    console.log(`[ProcessDca] Found ${duePlans.length} due plans.`);

    // Batch fetch prices
    const tickers = [...new Set(duePlans.map((p: DcaPlan) => `${p.ticker}.${p.market}`))];
    let prices: Record<string, StockPrice> = {};
    try {
      prices = await findata.fetchStockPrices(tickers as string[]);
    } catch (e) {
      console.error('[ProcessDca] Failed to fetch prices, continuing with null prices:', e);
    }

    let processed = 0;
    let failed = 0;

    for (const plan of duePlans as DcaPlan[]) {
      const priceKey = `${plan.ticker}.${plan.market}`;
      const priceData: StockPrice | null = prices[priceKey] || prices[plan.ticker] || null;
      const suggestedPrice = priceData?.price ?? null;
      const suggestedShares =
        plan.mode === 'amount' && suggestedPrice && plan.amount
          ? Math.round((plan.amount / suggestedPrice) * 1e6) / 1e6
          : null;

      const { error: insertError } = await this.supabase.from('dca_pending').insert({
        dca_plan_id: plan.id,
        portfolio_id: plan.portfolio_id,
        ticker: plan.ticker,
        market: plan.market,
        currency: plan.currency,
        scheduled_date: plan.next_run_date,
        mode: plan.mode,
        amount: plan.amount,
        shares: plan.shares,
        suggested_price: suggestedPrice,
        suggested_shares: suggestedShares,
      });

      if (insertError) {
        console.error(`[ProcessDca] Failed to insert pending for plan ${plan.id}:`, insertError);
        failed++;
        continue;
      }

      const nextDate = advanceDate(plan.next_run_date, plan.frequency);
      const { error: updateError } = await this.supabase
        .from('dca_plans')
        .update({
          last_run_date: plan.next_run_date,
          next_run_date: nextDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', plan.id);

      if (updateError) {
        console.error(`[ProcessDca] Failed to advance plan ${plan.id}:`, updateError);
      }

      console.log(`[ProcessDca] Plan ${plan.id} (${plan.ticker}): pending created, next_run=${nextDate}`);
      processed++;
    }

    console.log(`[ProcessDca] Done. processed=${processed}, failed=${failed}`);
  }
}
