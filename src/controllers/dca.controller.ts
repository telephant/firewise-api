import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import { getViewContext } from '../utils/family-context';

export interface DcaPlan {
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
  last_run_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DcaPending {
  id: string;
  dca_plan_id: string;
  portfolio_id: string;
  ticker: string;
  market: string;
  currency: string;
  scheduled_date: string;
  mode: 'amount' | 'shares';
  amount: number | null;
  shares: number | null;
  suggested_price: number | null;
  suggested_shares: number | null;
  status: 'pending' | 'confirmed' | 'skipped';
  confirmed_price: number | null;
  confirmed_shares: number | null;
  trade_id: string | null;
  created_at: string;
}

/** Returns portfolio IDs for the current context */
async function getPortfolioIds(belongId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('portfolios')
    .select('id')
    .eq('belong_id', belongId);
  return (data || []).map((p: { id: string }) => p.id);
}

function advanceDate(date: string, frequency: DcaPlan['frequency']): string {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

// GET /fire/dca/plans
export const listPlans = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPlan[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    const { data, error } = await supabaseAdmin
      .from('dca_plans')
      .select('*')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .order('created_at', { ascending: false });

    if (error) throw new AppError('Failed to fetch DCA plans', 500);
    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch DCA plans' });
  }
};

// POST /fire/dca/plans
export const createPlan = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPlan>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { portfolio_id, ticker, market, currency, frequency, mode, amount, shares, start_date, notes } = req.body;

    if (!portfolio_id || !ticker || !market || !currency || !frequency || !mode || !start_date) {
      throw new AppError('portfolio_id, ticker, market, currency, frequency, mode, and start_date are required', 400);
    }
    if (!['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(frequency)) {
      throw new AppError('frequency must be weekly, biweekly, monthly, quarterly, or yearly', 400);
    }
    if (!['amount', 'shares'].includes(mode)) {
      throw new AppError('mode must be amount or shares', 400);
    }
    if (mode === 'amount' && (amount === undefined || amount === null)) {
      throw new AppError('amount is required when mode is amount', 400);
    }
    if (mode === 'shares' && (shares === undefined || shares === null)) {
      throw new AppError('shares is required when mode is shares', 400);
    }

    // Verify portfolio belongs to current context
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('id')
      .eq('id', portfolio_id)
      .eq('belong_id', ctx.belongId)
      .single();
    if (!portfolio) throw new AppError('Portfolio not found', 404);

    const { data, error } = await supabaseAdmin
      .from('dca_plans')
      .insert({
        portfolio_id,
        ticker: ticker.toUpperCase(),
        market,
        currency,
        frequency,
        mode,
        amount: mode === 'amount' ? Number(amount) : null,
        shares: mode === 'shares' ? Number(shares) : null,
        next_run_date: start_date,
        notes: notes || null,
      })
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to create DCA plan', 500);
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create DCA plan' });
  }
};

// PUT /fire/dca/plans/:id
export const updatePlan = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPlan>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const planId = req.params.id;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    // Verify ownership
    const { data: existing } = await supabaseAdmin
      .from('dca_plans')
      .select('id')
      .eq('id', planId)
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();
    if (!existing) throw new AppError('DCA plan not found', 404);

    const { frequency, mode, amount, shares, next_run_date, is_active, notes } = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (frequency !== undefined) updates.frequency = frequency;
    if (mode !== undefined) updates.mode = mode;
    if (amount !== undefined) updates.amount = amount !== null ? Number(amount) : null;
    if (shares !== undefined) updates.shares = shares !== null ? Number(shares) : null;
    if (next_run_date !== undefined) updates.next_run_date = next_run_date;
    if (is_active !== undefined) updates.is_active = is_active;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabaseAdmin
      .from('dca_plans')
      .update(updates)
      .eq('id', planId)
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to update DCA plan', 500);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update DCA plan' });
  }
};

// DELETE /fire/dca/plans/:id
export const deletePlan = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<null>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const planId = req.params.id;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    const { data: existing } = await supabaseAdmin
      .from('dca_plans')
      .select('id')
      .eq('id', planId)
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();
    if (!existing) throw new AppError('DCA plan not found', 404);

    const { error } = await supabaseAdmin
      .from('dca_plans')
      .delete()
      .eq('id', planId);

    if (error) throw new AppError('Failed to delete DCA plan', 500);
    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to delete DCA plan' });
  }
};

// GET /fire/dca/pending
export const listPending = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPending[]>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const { portfolio_id } = req.query;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    let query = supabaseAdmin
      .from('dca_pending')
      .select('*')
      .eq('status', 'pending')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .order('scheduled_date', { ascending: true });

    if (portfolio_id) {
      query = query.eq('portfolio_id', portfolio_id as string);
    }

    const { data, error } = await query;
    if (error) throw new AppError('Failed to fetch pending DCA records', 500);
    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch pending DCA records' });
  }
};

// POST /fire/dca/pending/:id/confirm
export const confirmPending = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPending>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const pendingId = req.params.id;
    const { confirmed_price, confirmed_shares } = req.body;

    if (confirmed_price === undefined || confirmed_shares === undefined) {
      throw new AppError('confirmed_price and confirmed_shares are required', 400);
    }
    if (Number(confirmed_price) <= 0 || Number(confirmed_shares) <= 0) {
      throw new AppError('confirmed_price and confirmed_shares must be positive', 400);
    }

    const portfolioIds = await getPortfolioIds(ctx.belongId);
    const { data: pending } = await supabaseAdmin
      .from('dca_pending')
      .select('*')
      .eq('id', pendingId)
      .eq('status', 'pending')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();

    if (!pending) throw new AppError('Pending DCA record not found', 404);

    // Create the trade
    const { data: trade, error: tradeError } = await supabaseAdmin
      .from('trades')
      .insert({
        portfolio_id: pending.portfolio_id,
        ticker: pending.ticker,
        market: pending.market,
        type: 'buy',
        shares: Number(confirmed_shares),
        price: Number(confirmed_price),
        currency: pending.currency,
        date: pending.scheduled_date,
        notes: `DCA`,
      })
      .select()
      .single();

    if (tradeError || !trade) throw new AppError('Failed to create trade', 500);

    // Update pending record
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('dca_pending')
      .update({
        status: 'confirmed',
        confirmed_price: Number(confirmed_price),
        confirmed_shares: Number(confirmed_shares),
        trade_id: trade.id,
      })
      .eq('id', pendingId)
      .select()
      .single();

    if (updateError || !updated) throw new AppError('Failed to update pending record', 500);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to confirm DCA pending' });
  }
};

// POST /fire/dca/pending/:id/skip
export const skipPending = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<DcaPending>>
): Promise<void> => {
  try {
    const ctx = await getViewContext(req);
    const pendingId = req.params.id;
    const portfolioIds = await getPortfolioIds(ctx.belongId);

    const { data: existing } = await supabaseAdmin
      .from('dca_pending')
      .select('id')
      .eq('id', pendingId)
      .eq('status', 'pending')
      .in('portfolio_id', portfolioIds.length ? portfolioIds : [''])
      .single();

    if (!existing) throw new AppError('Pending DCA record not found', 404);

    const { data, error } = await supabaseAdmin
      .from('dca_pending')
      .update({ status: 'skipped' })
      .eq('id', pendingId)
      .select()
      .single();

    if (error || !data) throw new AppError('Failed to skip pending record', 500);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to skip DCA pending' });
  }
};

// POST /fire/dca/process  (manual trigger for testing)
export const processDca = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ processed: number }>>
): Promise<void> => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: duePlans, error } = await supabaseAdmin
      .from('dca_plans')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);

    if (error) throw new AppError('Failed to fetch due plans', 500);
    if (!duePlans || duePlans.length === 0) {
      res.json({ success: true, data: { processed: 0 } });
      return;
    }

    const { fetchStockPrices } = await import('../utils/findata-client');
    const tickers = [...new Set(duePlans.map((p: DcaPlan) => `${p.ticker}.${p.market}`))];
    const prices = await fetchStockPrices(tickers);

    let processed = 0;
    for (const plan of duePlans as DcaPlan[]) {
      const priceKey = `${plan.ticker}.${plan.market}`;
      const priceData = prices[priceKey] || prices[plan.ticker];
      const suggestedPrice = priceData?.price ?? null;
      const suggestedShares =
        plan.mode === 'amount' && suggestedPrice && plan.amount
          ? Math.round((plan.amount / suggestedPrice) * 1e6) / 1e6
          : null;

      const { error: insertError } = await supabaseAdmin.from('dca_pending').insert({
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
        console.error(`Failed to insert pending for plan ${plan.id}:`, insertError);
        continue;
      }

      const nextDate = advanceDate(plan.next_run_date, plan.frequency);
      await supabaseAdmin
        .from('dca_plans')
        .update({ last_run_date: plan.next_run_date, next_run_date: nextDate, updated_at: new Date().toISOString() })
        .eq('id', plan.id);

      processed++;
    }

    res.json({ success: true, data: { processed } });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to process DCA' });
  }
};
