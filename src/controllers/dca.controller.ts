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
  price_reference: 'open' | 'close' | 'delay';
  price_delay_minutes: number | null;
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
  const originalDay = d.getDate();

  switch (frequency) {
    case 'weekly':   d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
      d.setDate(1); // anchor to 1st to avoid overflow during month change
      d.setMonth(d.getMonth() + months);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, daysInMonth));
      break;
    }
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
    const { portfolio_id, ticker, market, currency, frequency, mode, amount, shares, start_date, notes, price_reference, price_delay_minutes } = req.body;

    if (!portfolio_id || !ticker || !market || !currency || !frequency || !mode || !start_date) {
      throw new AppError('portfolio_id, ticker, market, currency, frequency, mode, and start_date are required', 400);
    }
    const priceRef = price_reference || 'close';
    if (!['open', 'close', 'delay'].includes(priceRef)) {
      throw new AppError('price_reference must be open, close, or delay', 400);
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
        price_reference: priceRef,
        price_delay_minutes: priceRef === 'delay' && price_delay_minutes ? Number(price_delay_minutes) : null,
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

    const { frequency, mode, amount, shares, next_run_date, is_active, notes, price_reference, price_delay_minutes } = req.body;

    if (frequency !== undefined && !['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(frequency)) {
      throw new AppError('frequency must be weekly, biweekly, monthly, quarterly, or yearly', 400);
    }
    if (mode !== undefined && !['amount', 'shares'].includes(mode)) {
      throw new AppError('mode must be amount or shares', 400);
    }
    if (price_reference !== undefined && !['open', 'close', 'delay'].includes(price_reference)) {
      throw new AppError('price_reference must be open, close, or delay', 400);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (frequency !== undefined) updates.frequency = frequency;
    if (mode !== undefined) updates.mode = mode;
    if (amount !== undefined) updates.amount = amount !== null ? Number(amount) : null;
    if (shares !== undefined) updates.shares = shares !== null ? Number(shares) : null;
    if (next_run_date !== undefined) updates.next_run_date = next_run_date;
    if (is_active !== undefined) updates.is_active = is_active;
    if (notes !== undefined) updates.notes = notes;
    if (price_reference !== undefined) {
      updates.price_reference = price_reference;
      updates.price_delay_minutes = price_reference === 'delay' && price_delay_minutes ? Number(price_delay_minutes) : null;
    }

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

    const records = data || [];

    // For any records missing suggested_price, fetch current price and backfill
    const missing = records.filter((r: DcaPending) => r.suggested_price === null);
    if (missing.length > 0) {
      const { fetchStockPrices, formatTickerForYFinance } = await import('../utils/findata-client');
      const tickers = [...new Set(missing.map((r: DcaPending) => formatTickerForYFinance(r.ticker, r.market)))];
      const prices = await fetchStockPrices(tickers as string[]);

      for (const record of missing) {
        const yfTicker = formatTickerForYFinance(record.ticker, record.market);
        const priceData = prices[yfTicker] || prices[record.ticker];
        if (!priceData?.price) continue;
        const suggestedPrice = priceData.price;
        const suggestedShares =
          record.mode === 'amount' && record.amount
            ? Math.round((record.amount / suggestedPrice) * 1e6) / 1e6
            : null;
        // Update in DB so next load is instant
        await supabaseAdmin.from('dca_pending').update({
          suggested_price: suggestedPrice,
          suggested_shares: suggestedShares,
        }).eq('id', record.id);
        // Patch in-memory response too
        record.suggested_price = suggestedPrice;
        record.suggested_shares = suggestedShares;
      }
    }

    res.json({ success: true, data: records });
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

    const { fetchStockPrices, fetchPriceAtTime, formatTickerForYFinance } = await import('../utils/findata-client');

    // For 'close' mode, batch fetch current prices; for open/delay, fetch individually
    const closePlans = (duePlans as DcaPlan[]).filter(p => (p.price_reference || 'close') === 'close');
    const closeTickers = [...new Set(closePlans.map((p: DcaPlan) => formatTickerForYFinance(p.ticker, p.market)))];
    const closePrices = closeTickers.length > 0 ? await fetchStockPrices(closeTickers) : {};

    let processed = 0;
    for (const plan of duePlans as DcaPlan[]) {
      const priceRef = plan.price_reference || 'close';
      const yfTicker = formatTickerForYFinance(plan.ticker, plan.market);
      let suggestedPrice: number | null = null;

      if (priceRef === 'close') {
        const priceData = closePrices[yfTicker] || closePrices[plan.ticker];
        suggestedPrice = priceData?.price ?? null;
      } else if (priceRef === 'open') {
        const data = await fetchPriceAtTime(yfTicker, 0);
        suggestedPrice = data?.price ?? null;
      } else if (priceRef === 'delay') {
        const minutes = plan.price_delay_minutes ?? 30;
        const data = await fetchPriceAtTime(yfTicker, minutes);
        suggestedPrice = data?.price ?? null;
      }
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
